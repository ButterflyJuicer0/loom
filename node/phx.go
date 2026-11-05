package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// The slice of the Phoenix channel protocol (serializer 2.0.0) a device needs:
// one socket, one channel ("node"), heartbeats. Every frame is a JSON array
//
//	[join_ref, ref, topic, event, payload]
//
// Pushes from the device carry no ref — nothing it sends wants a reply.

const (
	topic             = "node"
	heartbeatInterval = 15 * time.Second
	writeTimeout      = 20 * time.Second
)

// errRevoked: loom refused the token. Retrying soon will not change that.
var errRevoked = errors.New("loom refused this device's token (removed, or reinstalled elsewhere)")

type frame struct {
	JoinRef *string
	Ref     *string
	Topic   string
	Event   string
	Payload json.RawMessage
}

func (f *frame) UnmarshalJSON(b []byte) error {
	var parts [5]json.RawMessage
	if err := json.Unmarshal(b, &parts); err != nil {
		return err
	}
	for i, dst := range []**string{&f.JoinRef, &f.Ref} {
		if string(parts[i]) != "null" {
			var s string
			if err := json.Unmarshal(parts[i], &s); err != nil {
				return err
			}
			*dst = &s
		}
	}
	if err := json.Unmarshal(parts[2], &f.Topic); err != nil {
		return err
	}
	if err := json.Unmarshal(parts[3], &f.Event); err != nil {
		return err
	}
	f.Payload = parts[4]
	return nil
}

// conn is one live connection: the socket, joined to "node".
type conn struct {
	ws      *websocket.Conn
	out     chan []byte
	ref     atomic.Int64
	joinRef string
	name    string
}

// socketURL turns loom's origin into the device socket's address.
func socketURL(origin, token string) (string, error) {
	u, err := url.Parse(strings.TrimRight(origin, "/"))
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	default:
		return "", fmt.Errorf("loom url must be http or https, got %q", origin)
	}
	u.Path += "/node/websocket"
	u.RawQuery = url.Values{"vsn": {"2.0.0"}, "token": {token}}.Encode()
	return u.String(), nil
}

// preferIPv4 is set once an IPv4-only dial got through where the usual one did
// not, so later reconnects try IPv4 first instead of failing on IPv6 each time.
var preferIPv4 atomic.Bool

// dualClient is the usual dual-stack client (nil: the websocket default).
// A variable so a test can stand in a network whose IPv6 is broken.
var dualClient *http.Client

// ipv4Client dials over IPv4 only. Some networks hand out an IPv6 address
// whose path is broken past the connect: the TCP handshake looks fine, then
// the first write fails ("socket is not connected"). Go's dual-stack fallback
// only covers a connect that fails, so without this the device stays offline.
var ipv4Client = func() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	t.DialContext = func(ctx context.Context, _, addr string) (net.Conn, error) {
		return d.DialContext(ctx, "tcp4", addr)
	}
	return &http.Client{Transport: t}
}()

// dialSocket opens the websocket: the usual dual-stack way, then IPv4 only
// (or the other way round once IPv4 has been seen to work). Only a network
// failure moves on to the other way; an HTTP answer, such as a 403, is final.
// Each way gets its own 20s under parent, so one that hangs leaves the other
// its full time.
func dialSocket(parent context.Context, addr string) (*websocket.Conn, *http.Response, error) {
	opts := func(c *http.Client) *websocket.DialOptions {
		return &websocket.DialOptions{
			HTTPClient: c,
			HTTPHeader: http.Header{"User-Agent": {"loom-node/" + version}},
		}
	}
	v4First := preferIPv4.Load()
	first, second, secondName := dualClient, ipv4Client, "IPv4"
	if v4First {
		first, second, secondName = ipv4Client, dualClient, "dual stack"
	}
	try := func(c *http.Client) (*websocket.Conn, *http.Response, error) {
		ctx, cancel := context.WithTimeout(parent, 20*time.Second)
		defer cancel()
		return websocket.Dial(ctx, addr, opts(c))
	}
	ws, resp, err := try(first)
	if err == nil || resp != nil || parent.Err() != nil {
		return ws, resp, err
	}
	ws, resp, err2 := try(second)
	if err2 != nil {
		return nil, resp, fmt.Errorf("%w; retried over %s: %v", err, secondName, err2)
	}
	// Remember whichever way got through, so the next reconnect starts there.
	preferIPv4.Store(!v4First)
	if !v4First {
		log.Printf("connected over IPv4 after the usual dial failed; trying IPv4 first from now on")
	}
	return ws, resp, nil
}

// dial connects and joins, returning once loom has accepted the device.
func dial(ctx context.Context, origin, token string, info map[string]string) (*conn, error) {
	addr, err := socketURL(origin, token)
	if err != nil {
		return nil, err
	}

	ws, resp, err := dialSocket(ctx, addr)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusForbidden {
			return nil, errRevoked
		}
		// The dial error quotes the URL, token included, and it gets logged.
		msg := strings.ReplaceAll(err.Error(), url.QueryEscape(token), "REDACTED")
		return nil, errors.New(strings.ReplaceAll(msg, token, "REDACTED"))
	}
	// Files travel as 256 KiB chunks, base64'd; leave room.
	ws.SetReadLimit(8 << 20)

	// The join gets its own time, whichever way the socket came up.
	dctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	c := &conn{ws: ws, out: make(chan []byte, 64)}
	c.joinRef = c.nextRef()
	if err := c.writeNow(dctx, c.joinRef, c.joinRef, topic, "phx_join", info); err != nil {
		ws.CloseNow()
		return nil, err
	}

	// The reply to the join is the first thing that matters; anything else
	// before it would be a protocol error on loom's side.
	for {
		f, err := c.read(dctx)
		if err != nil {
			ws.CloseNow()
			return nil, err
		}
		if f.Event != "phx_reply" || f.Ref == nil || *f.Ref != c.joinRef {
			continue
		}
		var reply struct {
			Status   string `json:"status"`
			Response struct {
				Name   string `json:"name"`
				Reason string `json:"reason"`
			} `json:"response"`
		}
		if err := json.Unmarshal(f.Payload, &reply); err != nil {
			ws.CloseNow()
			return nil, err
		}
		if reply.Status != "ok" {
			ws.CloseNow()
			return nil, fmt.Errorf("loom refused the join: %s", reply.Response.Reason)
		}
		c.name = reply.Response.Name
		return c, nil
	}
}

func (c *conn) nextRef() string { return strconv.FormatInt(c.ref.Add(1), 10) }

func encode(joinRef, ref any, topic, event string, payload any) ([]byte, error) {
	return json.Marshal([]any{joinRef, ref, topic, event, payload})
}

func (c *conn) writeNow(ctx context.Context, joinRef, ref any, topic, event string, payload any) error {
	b, err := encode(joinRef, ref, topic, event, payload)
	if err != nil {
		return err
	}
	return c.ws.Write(ctx, websocket.MessageText, b)
}

func (c *conn) read(ctx context.Context) (*frame, error) {
	_, b, err := c.ws.Read(ctx)
	if err != nil {
		return nil, err
	}
	var f frame
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("bad frame from loom: %w", err)
	}
	return &f, nil
}

// push queues an event for the device's channel. It blocks while the socket is
// behind, which is the backpressure a big file read needs; ctx is the
// connection's, so a dropped connection unblocks it.
func (c *conn) push(ctx context.Context, event string, payload any) error {
	b, err := encode(c.joinRef, nil, topic, event, payload)
	if err != nil {
		return err
	}
	select {
	case c.out <- b:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// run pumps the connection until it fails: writes from the queue, heartbeats,
// and every frame read handed to onEvent. It returns why the connection ended.
func (c *conn) run(ctx context.Context, onEvent func(event string, payload json.RawMessage)) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer c.ws.CloseNow()

	errs := make(chan error, 2)
	var pending atomic.Value // the heartbeat ref still unanswered, or ""
	pending.Store("")

	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-c.out:
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := c.ws.Write(wctx, websocket.MessageText, b)
				wcancel()
				if err != nil {
					errs <- err
					return
				}
			case <-ticker.C:
				// Still waiting on the last one: the far end is gone even if
				// the TCP connection has not noticed yet.
				if pending.Load().(string) != "" {
					errs <- errors.New("loom stopped answering heartbeats")
					return
				}
				ref := c.nextRef()
				pending.Store(ref)
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := c.writeNow(wctx, nil, ref, "phoenix", "heartbeat", map[string]any{})
				wcancel()
				if err != nil {
					errs <- err
					return
				}
			}
		}
	}()

	go func() {
		for {
			f, err := c.read(ctx)
			if err != nil {
				errs <- err
				return
			}
			switch {
			case f.Topic == "phoenix" && f.Event == "phx_reply":
				if f.Ref != nil && *f.Ref == pending.Load().(string) {
					pending.Store("")
				}
			case f.Topic != topic:
			case f.Event == "phx_error" || f.Event == "phx_close":
				// The channel is gone — replaced by a newer connection, or the
				// device was removed. Redialling finds out which.
				errs <- errors.New("loom closed the channel")
				return
			case f.Event == "phx_reply":
			default:
				onEvent(f.Event, f.Payload)
			}
		}
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
