package main

import (
	"net"
	"testing"
	"time"
)

func TestTopicMatch(t *testing.T) {
	cases := []struct {
		f, t string
		ok   bool
	}{
		{"a/b", "a/b", true},
		{"a/+", "a/b", true},
		{"a/+", "a/b/c", false},
		{"a/#", "a", true},
		{"a/#", "a/b/c", true},
		{"#", "a/b", true},
		{"+/b", "a/b", true},
		{"#", "$SYS/x", false},
		{"$SYS/#", "$SYS/x", true},
		{"a/b", "a/c", false},
	}
	for _, c := range cases {
		if got := topicMatch(c.f, c.t); got != c.ok {
			t.Errorf("topicMatch(%q, %q) = %v", c.f, c.t, got)
		}
	}
	for _, f := range []string{"a/#/b", "a#", "a+/b", ""} {
		if validFilter(f) {
			t.Errorf("validFilter(%q) = true", f)
		}
	}
}

func startTestBroker(t *testing.T) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go newBroker(map[string]string{"dog": "pw"}).serve(ln)
	return ln.Addr().String()
}

func TestMQTTLogin(t *testing.T) {
	addr := startTestBroker(t)
	if _, _, err := mqttDial(addr, "dog", "wrong"); err == nil {
		t.Fatal("wrong password accepted")
	}
	if _, _, err := mqttDial(addr, "", ""); err == nil {
		t.Fatal("anonymous login accepted")
	}
	c, _, err := mqttDial(addr, "dog", "pw")
	if err != nil {
		t.Fatal(err)
	}
	c.Close()
}

func TestMQTTPubSub(t *testing.T) {
	addr := startTestBroker(t)
	sub, r, err := mqttDial(addr, "dog", "pw")
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	body := putString([]byte{0, 7}, "home/+/say")
	sub.Write(appendPacket(pSubscribe<<4|2, append(body, 1)))
	sub.SetReadDeadline(time.Now().Add(3 * time.Second))
	typ, _, ack, err := readPacket(r)
	if err != nil || typ != pSuback || len(ack) != 3 || ack[2] != 0 {
		t.Fatalf("SUBACK: %d %v %v", typ, ack, err)
	}

	pub, pr, err := mqttDial(addr, "dog", "pw")
	if err != nil {
		t.Fatal(err)
	}
	defer pub.Close()
	// QoS 1 publish: expect a PUBACK, and delivery at QoS 0.
	p := putString(nil, "home/xiaobai/say")
	p = append(p, 0, 9)
	p = append(p, "你好"...)
	pub.Write(appendPacket(pPublish<<4|2, p))
	pub.Write(encodePublish("home/other", []byte("no")))
	pub.SetReadDeadline(time.Now().Add(3 * time.Second))
	if typ, _, b, err := readPacket(pr); err != nil || typ != pPuback || b[1] != 9 {
		t.Fatalf("PUBACK: %d %v %v", typ, b, err)
	}

	typ, flags, msg, err := readPacket(r)
	if err != nil || typ != pPublish || flags != 0 {
		t.Fatalf("PUBLISH: %d %d %v", typ, flags, err)
	}
	topic, payload, _ := mqttString(msg)
	if topic != "home/xiaobai/say" || string(payload) != "你好" {
		t.Fatalf("got %q %q", topic, payload)
	}

	// Ping works, and the unmatched topic never arrived.
	sub.Write([]byte{pPingreq << 4, 0})
	if typ, _, _, err := readPacket(r); err != nil || typ != pPingresp {
		t.Fatalf("after ping: %d %v", typ, err)
	}
}
