package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// On Android, Loom can drive the screen through the app's accessibility service,
// which listens on 127.0.0.1:controlPort guarded by a token in the app's private
// dir. `loom-node control` is that client — so a device needs no curl/wget (a
// stripped HarmonyOS shell has none). The agent calls it on-device via the
// symlink the daemon drops at $HOME/loom-node (see ensureControlLink):
//
//	loom-node exec <device> -- '"$HOME/loom-node" control dump'
//	loom-node exec <device> -- '"$HOME/loom-node" control tap x=540 y=1200'
//	loom-node exec <device> -- '"$HOME/loom-node" control text s="你好"'
const controlPort = "8766"

func controlTokenPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".config", "loom-node", "control.token")
}

// ensureControlLink drops a stable, callable name for this binary next to the
// config, so the agent can invoke `control` without knowing the APK's random
// native-library path. A symlink is enough: exec follows it to the real file in
// nativeLibraryDir, the one place Android allows exec. Android only.
func ensureControlLink() {
	if runtime.GOOS != "android" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	link := filepath.Join(home, "loom-node")
	if cur, err := os.Readlink(link); err == nil && cur == exe {
		return
	}
	_ = os.Remove(link)
	_ = os.Symlink(exe, link)
}

func cliControl(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: loom-node control <path> [key=value ...]\n"+
			"  e.g. control dump | control screenshot | control tap x=540 y=1200 |\n"+
			"       control swipe x1=540 y1=1600 x2=540 y2=400 | control text s=hello |\n"+
			"       control key name=back|home|recents|notifications | control launch pkg=com.foo")
		return 2
	}

	tok, err := os.ReadFile(controlTokenPath())
	if err != nil {
		fmt.Fprintln(os.Stderr, "no control token: open the Loom Node app and turn on 屏幕控制 (accessibility). Then retry.")
		return exitLoom
	}

	q := url.Values{}
	q.Set("t", strings.TrimSpace(string(tok)))
	for _, a := range args[1:] {
		k, v, ok := strings.Cut(a, "=")
		if !ok {
			fmt.Fprintf(os.Stderr, "argument %q is not key=value\n", a)
			return 2
		}
		q.Set(k, v)
	}

	path := strings.TrimPrefix(args[0], "/")
	u := "http://127.0.0.1:" + controlPort + "/" + path + "?" + q.Encode()

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot reach the control service on this device: %v\n"+
			"turn on 屏幕控制 in the Loom Node app (accessibility), then retry.\n", err)
		return exitLoom
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	os.Stdout.Write(body)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
