package main

// An optional, minimal MQTT 3.1.1 broker inside the daemon, for the devices at
// home (a robot dog, a desk robot, sensors) to talk to each other on the LAN.
// Off unless asked for, so a plain node opens no port:
//
//	loom-node daemon --mqtt 192.168.1.1:1883
//	or "mqtt": {"listen": "192.168.1.1:1883", "users": {"dog": "…"}} in config.json
//
// Scope, on purpose: one broker per node, no bridging. QoS 0 delivery only: a
// QoS 1/2 PUBLISH is acknowledged and then delivered at QoS 0, and SUBACK
// grants QoS 0. No retained messages, no wills, no persistent sessions. Every
// client must log in with a user and password from config.json.
// Packet layout follows the OASIS MQTT 3.1.1 spec (mqtt-v3.1.1-os), §2–§3.

import (
	"bufio"
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type mqttConfig struct {
	Listen string            `json:"listen"`
	Users  map[string]string `json:"users"` // user -> password
}

const (
	mqttMaxPacket  = 256 << 10
	mqttMaxClients = 64
	mqttMaxSubs    = 64
	mqttQueue      = 256 // per client; QoS 0, so a slow client loses messages
)

// MQTT control packet types (§2.2.1).
const (
	pConnect     = 1
	pConnack     = 2
	pPublish     = 3
	pPuback      = 4
	pPubrec      = 5
	pPubrel      = 6
	pPubcomp     = 7
	pSubscribe   = 8
	pSuback      = 9
	pUnsubscribe = 10
	pUnsuback    = 11
	pPingreq     = 12
	pPingresp    = 13
	pDisconnect  = 14
)

type broker struct {
	users map[string]string

	mu      sync.Mutex
	clients map[string]*mqttClient // by client id
}

type mqttClient struct {
	id   string
	conn net.Conn
	out  chan []byte
	once sync.Once

	mu   sync.Mutex
	subs map[string]bool
}

func (c *mqttClient) close() { c.once.Do(func() { c.conn.Close() }) }

func newBroker(users map[string]string) *broker {
	return &broker{users: users, clients: map[string]*mqttClient{}}
}

// startMQTT runs the broker for as long as the process lives. It logs and
// returns on a bad address rather than stopping the daemon.
func startMQTT(mc *mqttConfig) {
	if len(mc.Users) == 0 {
		log.Printf("mqtt: not started: config.json has no mqtt.users (an open broker is not allowed)")
		return
	}
	ln, err := net.Listen("tcp", mc.Listen)
	if err != nil {
		log.Printf("mqtt: not started: %v", err)
		return
	}
	log.Printf("mqtt: listening on %s (%d users)", ln.Addr(), len(mc.Users))
	go newBroker(mc.Users).serve(ln)
}

func (b *broker) serve(ln net.Listener) error {
	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return err
			}
			time.Sleep(100 * time.Millisecond)
			continue
		}
		go b.handle(conn)
	}
}

func (b *broker) handle(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)

	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	typ, _, body, err := readPacket(r)
	if err != nil || typ != pConnect {
		return
	}
	id, user, keepalive, rc := b.parseConnect(body)
	if rc != 0 {
		conn.Write([]byte{pConnack << 4, 2, 0, rc})
		log.Printf("mqtt: refused %s (user %q): code %d", conn.RemoteAddr(), user, rc)
		return
	}

	c := &mqttClient{id: id, conn: conn, out: make(chan []byte, mqttQueue), subs: map[string]bool{}}
	if !b.add(c) {
		conn.Write([]byte{pConnack << 4, 2, 0, 3}) // server unavailable
		return
	}
	defer b.remove(c)
	log.Printf("mqtt: %s connected as %q (user %q)", conn.RemoteAddr(), id, user)

	go c.writer()
	c.send([]byte{pConnack << 4, 2, 0, 0})

	for {
		// §3.1.2.10: one and a half keep-alive periods without a packet ends it.
		if keepalive > 0 {
			conn.SetReadDeadline(time.Now().Add(time.Duration(keepalive) * 1500 * time.Millisecond))
		} else {
			conn.SetReadDeadline(time.Time{})
		}
		typ, flags, body, err := readPacket(r)
		if err != nil {
			log.Printf("mqtt: %q gone: %v", id, err)
			return
		}
		switch typ {
		case pPublish:
			if err := b.onPublish(c, flags, body); err != nil {
				log.Printf("mqtt: %q: %v", id, err)
				return
			}
		case pPubrel:
			if len(body) >= 2 {
				c.send(append([]byte{pPubcomp << 4, 2}, body[:2]...))
			}
		case pSubscribe:
			if err := c.onSubscribe(body, true); err != nil {
				log.Printf("mqtt: %q: %v", id, err)
				return
			}
		case pUnsubscribe:
			if err := c.onSubscribe(body, false); err != nil {
				log.Printf("mqtt: %q: %v", id, err)
				return
			}
		case pPingreq:
			c.send([]byte{pPingresp << 4, 0})
		case pDisconnect:
			log.Printf("mqtt: %q disconnected", id)
			return
		case pPuback, pPubrec, pPubcomp:
			// We only send QoS 0, so there is nothing to track.
		default:
			log.Printf("mqtt: %q: unexpected packet type %d", id, typ)
			return
		}
	}
}

// parseConnect checks a CONNECT body (§3.1) and the login. rc is the CONNACK
// return code: 0 ok, 1 bad protocol, 2 bad client id, 4 bad user or password.
func (b *broker) parseConnect(p []byte) (id, user string, keepalive uint16, rc byte) {
	name, p, ok := mqttString(p)
	if !ok || len(p) < 4 {
		return "", "", 0, 1
	}
	level, flags := p[0], p[1]
	keepalive = binary.BigEndian.Uint16(p[2:4])
	p = p[4:]
	if !(name == "MQTT" && level == 4) && !(name == "MQIsdp" && level == 3) {
		return "", "", 0, 1
	}
	if id, p, ok = mqttString(p); !ok {
		return "", "", 0, 2
	}
	if flags&0x04 != 0 { // a will: topic and message, which we ignore
		var skip string
		if _, p, ok = mqttString(p); !ok {
			return "", "", 0, 2
		}
		if skip, p, ok = mqttString(p); !ok {
			return "", "", 0, 2
		}
		_ = skip
	}
	var pass string
	if flags&0x80 != 0 {
		if user, p, ok = mqttString(p); !ok {
			return "", "", 0, 4
		}
	}
	if flags&0x40 != 0 {
		if pass, _, ok = mqttString(p); !ok {
			return "", user, 0, 4
		}
	}
	want, known := b.users[user]
	if flags&0x80 == 0 || !known || subtle.ConstantTimeCompare([]byte(pass), []byte(want)) != 1 {
		return "", user, 0, 4
	}
	if id == "" {
		id = fmt.Sprintf("%s-%d", user, time.Now().UnixNano())
	}
	return id, user, keepalive, 0
}

// add registers c, closing an older client with the same id (§3.1.4).
func (b *broker) add(c *mqttClient) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if old := b.clients[c.id]; old != nil {
		old.close()
	} else if len(b.clients) >= mqttMaxClients {
		return false
	}
	b.clients[c.id] = c
	return true
}

func (b *broker) remove(c *mqttClient) {
	b.mu.Lock()
	if b.clients[c.id] == c {
		delete(b.clients, c.id)
	}
	b.mu.Unlock()
	c.close()
	close(c.out)
}

func (b *broker) onPublish(c *mqttClient, flags byte, p []byte) error {
	qos := (flags >> 1) & 3
	topic, p, ok := mqttString(p)
	if !ok || qos == 3 || topic == "" || strings.ContainsAny(topic, "+#") {
		return errors.New("malformed PUBLISH")
	}
	if qos > 0 {
		if len(p) < 2 {
			return errors.New("malformed PUBLISH")
		}
		ack := byte(pPuback)
		if qos == 2 {
			ack = pPubrec
		}
		c.send(append([]byte{ack << 4, 2}, p[:2]...))
		p = p[2:]
	}
	b.publish(topic, p)
	return nil
}

// publish sends a message at QoS 0 to every client subscribed to topic.
func (b *broker) publish(topic string, payload []byte) {
	pkt := encodePublish(topic, payload)
	b.mu.Lock()
	targets := make([]*mqttClient, 0, len(b.clients))
	for _, c := range b.clients {
		targets = append(targets, c)
	}
	b.mu.Unlock()
	for _, c := range targets {
		if c.wants(topic) {
			c.send(pkt)
		}
	}
}

func (c *mqttClient) wants(topic string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for f := range c.subs {
		if topicMatch(f, topic) {
			return true
		}
	}
	return false
}

// onSubscribe handles SUBSCRIBE (sub) or UNSUBSCRIBE (!sub), §3.8 and §3.10.
func (c *mqttClient) onSubscribe(p []byte, sub bool) error {
	if len(p) < 2 {
		return errors.New("malformed SUBSCRIBE")
	}
	pid := p[:2]
	p = p[2:]
	var codes []byte
	for len(p) > 0 {
		f, rest, ok := mqttString(p)
		if !ok {
			return errors.New("malformed SUBSCRIBE")
		}
		p = rest
		if sub {
			if len(p) < 1 {
				return errors.New("malformed SUBSCRIBE")
			}
			p = p[1:] // requested QoS; we grant 0
		}
		c.mu.Lock()
		switch {
		case !sub:
			delete(c.subs, f)
		case !validFilter(f) || (len(c.subs) >= mqttMaxSubs && !c.subs[f]):
			codes = append(codes, 0x80)
		default:
			c.subs[f] = true
			codes = append(codes, 0)
		}
		c.mu.Unlock()
	}
	if sub {
		if len(codes) == 0 {
			return errors.New("SUBSCRIBE with no filters")
		}
		c.send(appendPacket(pSuback<<4, append(append([]byte{}, pid...), codes...)))
	} else {
		c.send(append([]byte{pUnsuback << 4, 2}, pid...))
	}
	return nil
}

// send queues a packet. QoS 0: when the client is too slow, the packet is
// dropped rather than holding up the publisher.
func (c *mqttClient) send(pkt []byte) {
	defer func() { recover() }() // out closed: the client just left
	select {
	case c.out <- pkt:
	default:
	}
}

func (c *mqttClient) writer() {
	for pkt := range c.out {
		c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := c.conn.Write(pkt); err != nil {
			c.close()
			for range c.out {
			}
			return
		}
	}
}

// ---- topics (§4.7) ----

func validFilter(f string) bool {
	if f == "" {
		return false
	}
	levels := strings.Split(f, "/")
	for i, l := range levels {
		if strings.Contains(l, "#") && (l != "#" || i != len(levels)-1) {
			return false
		}
		if strings.Contains(l, "+") && l != "+" {
			return false
		}
	}
	return true
}

func topicMatch(filter, topic string) bool {
	// Wildcards at the first level do not match topics starting with $ (§4.7.2).
	if strings.HasPrefix(topic, "$") && (strings.HasPrefix(filter, "+") || strings.HasPrefix(filter, "#")) {
		return false
	}
	f, t := strings.Split(filter, "/"), strings.Split(topic, "/")
	for i, l := range f {
		if l == "#" {
			return true
		}
		if i >= len(t) || (l != "+" && l != t[i]) {
			return false
		}
	}
	return len(f) == len(t)
}

// ---- wire format ----

func readPacket(r *bufio.Reader) (typ, flags byte, body []byte, err error) {
	h, err := r.ReadByte()
	if err != nil {
		return 0, 0, nil, err
	}
	n, mul := 0, 1
	for i := 0; ; i++ {
		b, err := r.ReadByte()
		if err != nil {
			return 0, 0, nil, err
		}
		n += int(b&0x7f) * mul
		if b&0x80 == 0 {
			break
		}
		if i == 3 {
			return 0, 0, nil, errors.New("bad remaining length")
		}
		mul *= 128
	}
	if n > mqttMaxPacket {
		return 0, 0, nil, fmt.Errorf("packet of %d bytes is over the %d limit", n, mqttMaxPacket)
	}
	body = make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return 0, 0, nil, err
	}
	return h >> 4, h & 0x0f, body, nil
}

func appendPacket(header byte, body []byte) []byte {
	pkt := []byte{header}
	n := len(body)
	for {
		b := byte(n % 128)
		n /= 128
		if n > 0 {
			b |= 0x80
		}
		pkt = append(pkt, b)
		if n == 0 {
			break
		}
	}
	return append(pkt, body...)
}

func mqttString(p []byte) (string, []byte, bool) {
	if len(p) < 2 {
		return "", p, false
	}
	n := int(binary.BigEndian.Uint16(p))
	if len(p) < 2+n {
		return "", p, false
	}
	return string(p[2 : 2+n]), p[2+n:], true
}

func putString(b []byte, s string) []byte {
	b = binary.BigEndian.AppendUint16(b, uint16(len(s)))
	return append(b, s...)
}

func encodePublish(topic string, payload []byte) []byte {
	return appendPacket(pPublish<<4, append(putString(nil, topic), payload...))
}

// ---- `loom-node mqtt pub|sub`: a client for this node's own broker ----

func cliMQTT(args []string) int {
	const use = "usage: loom-node mqtt pub [--addr HOST:PORT] [--user U] TOPIC MESSAGE\n" +
		"       loom-node mqtt sub [--addr HOST:PORT] [--user U] FILTER...\n"
	if len(args) < 1 || (args[0] != "pub" && args[0] != "sub") {
		fmt.Fprint(os.Stderr, use)
		return 2
	}
	fs := flag.NewFlagSet("mqtt", flag.ContinueOnError)
	addr := fs.String("addr", "", "broker (default: this node's mqtt.listen)")
	user := fs.String("user", "", "login (default: the first of this node's mqtt.users)")
	if fs.Parse(args[1:]) != nil {
		return 2
	}
	rest := fs.Args()
	if (args[0] == "pub" && len(rest) != 2) || (args[0] == "sub" && len(rest) < 1) {
		fmt.Fprint(os.Stderr, use)
		return 2
	}

	mc := localMQTTConfig()
	if *addr == "" {
		if mc == nil || mc.Listen == "" {
			fmt.Fprintln(os.Stderr, "loom-node mqtt: no --addr and no mqtt.listen in config.json")
			return 1
		}
		*addr = mc.Listen
		if h, p, err := net.SplitHostPort(*addr); err == nil && (h == "" || h == "0.0.0.0" || h == "::") {
			*addr = net.JoinHostPort("127.0.0.1", p)
		}
	}
	var pass string
	if mc != nil && len(mc.Users) > 0 {
		if *user == "" {
			names := make([]string, 0, len(mc.Users))
			for n := range mc.Users {
				names = append(names, n)
			}
			sort.Strings(names)
			*user = names[0]
		}
		pass = mc.Users[*user]
	}
	if pass == "" {
		pass = os.Getenv("LOOM_MQTT_PASSWORD")
	}

	conn, r, err := mqttDial(*addr, *user, pass)
	if err != nil {
		fmt.Fprintln(os.Stderr, "loom-node mqtt:", err)
		return 1
	}
	defer conn.Close()

	if args[0] == "pub" {
		conn.Write(encodePublish(rest[0], []byte(rest[1])))
		conn.Write([]byte{pDisconnect << 4, 0})
		return 0
	}

	body := []byte{0, 1}
	for _, f := range rest {
		body = append(putString(body, f), 0)
	}
	conn.Write(appendPacket(pSubscribe<<4|2, body))
	go func() {
		for range time.Tick(30 * time.Second) {
			if _, err := conn.Write([]byte{pPingreq << 4, 0}); err != nil {
				return
			}
		}
	}()
	for {
		typ, _, body, err := readPacket(r)
		if err != nil {
			fmt.Fprintln(os.Stderr, "loom-node mqtt:", err)
			return 1
		}
		if typ == pPublish {
			if topic, payload, ok := mqttString(body); ok {
				fmt.Printf("%s %s\n", topic, payload)
			}
		}
	}
}

func localMQTTConfig() *mqttConfig {
	b, err := os.ReadFile(configPath())
	if err != nil {
		return nil
	}
	var c config
	if json.Unmarshal(b, &c) != nil {
		return nil
	}
	return c.MQTT
}

// mqttDial connects and logs in, keep-alive 60 s.
func mqttDial(addr, user, pass string) (net.Conn, *bufio.Reader, error) {
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return nil, nil, err
	}
	body := putString(nil, "MQTT")
	flags := byte(0x02)
	if user != "" {
		flags |= 0x80
	}
	if pass != "" {
		flags |= 0x40
	}
	body = append(body, 4, flags, 0, 60)
	body = putString(body, fmt.Sprintf("loom-node-%d-%d", os.Getpid(), time.Now().UnixNano()%1e9))
	if user != "" {
		body = putString(body, user)
	}
	if pass != "" {
		body = putString(body, pass)
	}
	conn.Write(appendPacket(pConnect<<4, body))
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	r := bufio.NewReader(conn)
	typ, _, ack, err := readPacket(r)
	conn.SetReadDeadline(time.Time{})
	if err != nil || typ != pConnack || len(ack) < 2 {
		conn.Close()
		return nil, nil, fmt.Errorf("no CONNACK from %s", addr)
	}
	if ack[1] != 0 {
		conn.Close()
		return nil, nil, fmt.Errorf("%s refused the login (code %d)", addr, ack[1])
	}
	return conn, r, nil
}
