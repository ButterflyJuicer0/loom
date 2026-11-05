package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/coder/websocket"
)

// A network whose IPv6 is broken past the connect: the usual dial fails with a
// network error and the IPv4-only one gets through, and is tried first after.
func TestDialFallsBackToIPv4(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err == nil {
			c.CloseNow()
		}
	}))
	defer srv.Close()

	var broken atomic.Int32
	dualClient = &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			broken.Add(1)
			return nil, errors.New("write: socket is not connected")
		},
	}}
	defer func() { dualClient = nil; preferIPv4.Store(false) }()
	preferIPv4.Store(false)

	addr := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx := context.Background()
	ws, _, err := dialSocket(ctx, addr)
	if err != nil {
		t.Fatalf("no fallback: %v", err)
	}
	ws.CloseNow()
	if !preferIPv4.Load() {
		t.Fatal("IPv4 not remembered")
	}
	if broken.Load() != 1 {
		t.Fatalf("broken dial tried %d times, want 1", broken.Load())
	}

	// Next reconnect goes straight to IPv4.
	ws, _, err = dialSocket(ctx, addr)
	if err != nil {
		t.Fatal(err)
	}
	ws.CloseNow()
	if broken.Load() != 1 {
		t.Fatalf("broken dial retried after IPv4 was remembered")
	}
}

// An HTTP answer is final: a refused device is not retried another way.
func TestDialNoFallbackOnHTTPAnswer(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Error(w, "no", http.StatusForbidden)
	}))
	defer srv.Close()
	preferIPv4.Store(false)

	ctx := context.Background()
	_, resp, err := dialSocket(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"))
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want a 403, got resp=%v err=%v", resp, err)
	}
	if hits.Load() != 1 || preferIPv4.Load() {
		t.Fatalf("retried after an HTTP answer: hits=%d preferIPv4=%v", hits.Load(), preferIPv4.Load())
	}
}
