package main

import (
	"context"
	"encoding/binary"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestExpand(t *testing.T) {
	home, _ := os.UserHomeDir()
	cases := map[string]string{
		"":          "",
		"~":         home,
		"~/a/b":     filepath.Join(home, "a", "b"),
		"notes.txt": filepath.Join(home, "notes.txt"),
		"~user/x":   filepath.Join(home, "~user", "x"),
	}
	if runtime.GOOS == "windows" {
		cases[`~\a`] = filepath.Join(home, "a")
		cases[`\tmp\x`] = filepath.VolumeName(home) + `\tmp\x`
		cases[`D:\x`] = `D:\x`
	} else {
		cases["/tmp/x"] = "/tmp/x"
	}
	for in, want := range cases {
		if got, err := expand(in); err != nil || got != want {
			t.Errorf("expand(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}

func TestGuiCopy(t *testing.T) {
	b := make([]byte, 0x200)
	binary.LittleEndian.PutUint32(b[0x3c:], 0x80)
	copy(b[0x80:], "PE\x00\x00")
	binary.LittleEndian.PutUint16(b[0x80+4+20+68:], 3) // console
	if err := guiCopy(b); err != nil {
		t.Fatal(err)
	}
	if got := binary.LittleEndian.Uint16(b[0x80+4+20+68:]); got != 2 {
		t.Fatalf("subsystem = %d, want 2", got)
	}
	if err := guiCopy([]byte("#!/bin/sh\n")); err == nil {
		t.Fatal("a shell script passed for a PE image")
	}
}

// A kill reaches what the command started, not just the shell.
func TestKillTakesTheGroup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs a Unix shell")
	}
	cmd := shellCommand("/bin/sh", "sleep 30 & sleep 30; echo unreachable")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	g := newGroup(cmd)
	time.AfterFunc(100*time.Millisecond, g.kill)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("the shell outlived the kill")
	}
	g.close()
	if code := exitCode(cmd.ProcessState); code != 128+15 {
		t.Fatalf("exit code %d, want 143", code)
	}
}

// What a removed device leaves behind: nothing of loom-node's. Linux only, as
// if run detached: no INVOCATION_ID, so no systemctl. (On macOS it would boot
// out the real launchd agent.) It deletes this test binary, which Linux allows
// while it runs.
func TestSelfUninstallLeavesNothing(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("would touch this machine's own loom-node service")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("INVOCATION_ID", "")
	for _, p := range []string{configPath(), stateDir("log"), stateDir("work", "repo", "a.txt")} {
		os.MkdirAll(filepath.Dir(p), 0o700)
		os.WriteFile(p, []byte("x"), 0o600)
	}

	if code := selfUninstall(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	for _, p := range []string{filepath.Dir(configPath()), stateDir()} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s is still there", p)
		}
	}
}

func TestDialErrorHidesToken(t *testing.T) {
	tok := "s3cret+/=tok"
	_, err := dial(context.Background(), "http://127.0.0.1:1", tok, nil)
	if err == nil {
		t.Fatal("dial to a closed port succeeded")
	}
	if strings.Contains(err.Error(), tok) || strings.Contains(err.Error(), url.QueryEscape(tok)) {
		t.Fatalf("token leaked: %v", err)
	}
}
