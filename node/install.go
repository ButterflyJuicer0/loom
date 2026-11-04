package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Installing makes the daemon a per-user login service — launchd on macOS, a
// systemd user unit on Linux (WSL included, when systemd is on), the Run key on
// Windows (see install_windows.go) — so it runs
// as the user, with their files and their shell, and comes back after a
// reboot. Not a system service: it would run as root, which is more reach than
// anything the agent asked for.

const (
	launchdLabel = "cloud.loom.node"
	systemdUnit  = "loom-node.service"
)

func runInstall(args []string) int {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	origin := fs.String("url", "", "loom's address, e.g. https://loom.example.com")
	// --token is kept for backward compatibility with older install scripts
	// but exposes the secret in the process table (ps, /proc/<pid>/cmdline).
	// New install scripts pipe the token on stdin and pass --token-stdin.
	// LOOM_NODE_TOKEN is a third option for callers that cannot pipe stdin.
	token := fs.String("token", "", "this device's token (DEPRECATED: visible in the process table; prefer --token-stdin)")
	tokenStdin := fs.Bool("token-stdin", false, "read the device's token from stdin (one line, trailing newline optional)")
	// Not $SHELL on Windows: Git Bash's is an MSYS path. The daemon picks
	// PowerShell when it starts.
	shellDefault := os.Getenv("SHELL")
	if runtime.GOOS == "windows" {
		shellDefault = ""
	}
	shell := fs.String("shell", shellDefault, "the shell commands run in")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	// Resolve the token. Precedence: --token-stdin, then LOOM_NODE_TOKEN, then
	// the --token flag (deprecated: visible in argv). Scrub the flag slot and
	// the env var after reading so a later ps/env dump cannot recover it.
	tokenValue := ""
	switch {
	case *tokenStdin:
		t, err := readTokenFromStdin()
		if err != nil {
			return die("reading --token-stdin: %v", err)
		}
		tokenValue = t
	case os.Getenv("LOOM_NODE_TOKEN") != "":
		tokenValue = os.Getenv("LOOM_NODE_TOKEN")
		os.Unsetenv("LOOM_NODE_TOKEN")
	case *token != "":
		tokenValue = *token
		fmt.Fprintln(os.Stderr, "loom-node: warning: --token on the command line is visible in the process table;"+
			" the install script should use --token-stdin instead")
	}
	// Best-effort scrub of the parsed flag copy so later heap/argv reads see
	// an empty string. The original argv slot itself is harder to overwrite
	// portably in Go; the install script no longer puts the secret there.
	*token = ""

	if *origin == "" || tokenValue == "" {
		fmt.Fprintln(os.Stderr, "usage: loom-node install --url URL --token-stdin [--shell SHELL]\n"+
			"(the install command in loom's Devices dialog does this for you)")
		return 2
	}

	cfg := config{URL: strings.TrimRight(*origin, "/"), Token: tokenValue, Shell: *shell}
	if err := writeConfig(cfg); err != nil {
		return die("%v", err)
	}
	fmt.Println("wrote", configPath())

	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		return die("cannot locate this binary: %v", err)
	}

	switch runtime.GOOS {
	case "darwin":
		err = installLaunchd(exe)
	case "android":
		err = installTermux(exe)
	case "linux":
		err = installSystemd(exe)
	case "windows":
		err = installWindows(exe)
	default:
		err = fmt.Errorf("%s is not supported", runtime.GOOS)
	}
	if err != nil {
		return die("%v", err)
	}

	fmt.Println("loom-node is running; the device shows a green dot under Devices in loom once it connects")
	fmt.Println("log of what loom ran here: ~/.local/state/loom-node/log")
	return 0
}

// readTokenFromStdin reads a single line (or EOF-terminated blob) from stdin
// and returns it with any trailing CR/LF stripped. An empty token is an
// error: it almost certainly means the caller forgot to pipe anything.
func readTokenFromStdin() (string, error) {
	r := bufio.NewReader(os.Stdin)
	line, err := r.ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return "", errors.New("empty token on stdin")
	}
	return line, nil
}

func writeConfig(cfg config) error {
	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ── macOS ───────────────────────────────────────────────────────────────

func plistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", launchdLabel+".plist")
}

func installLaunchd(exe string) error {
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(home, "Library", "Logs", "loom-node.log")
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array><string>%s</string><string>daemon</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, launchdLabel, exe, logPath, logPath)

	if err := os.MkdirAll(filepath.Dir(plistPath()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(plistPath(), []byte(plist), 0o644); err != nil {
		return err
	}

	domain := fmt.Sprintf("gui/%d", os.Getuid())
	// Whatever was loaded before, possibly an older binary.
	exec.Command("launchctl", "bootout", domain+"/"+launchdLabel).Run()
	if err := run("launchctl", "bootstrap", domain, plistPath()); err != nil {
		return err
	}
	fmt.Println("installed", plistPath(), "— logs in", logPath)
	return nil
}

// ── Linux ───────────────────────────────────────────────────────────────

func unitPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "systemd", "user", systemdUnit)
}

func installSystemd(exe string) error {
	if exec.Command("systemctl", "--user", "show-environment").Run() != nil {
		return installDetached(exe)
	}

	unit := fmt.Sprintf(`[Unit]
Description=loom-node: lets loom's agents run commands here
After=network-online.target

[Service]
ExecStart=%s daemon
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`, exe)

	if err := os.MkdirAll(filepath.Dir(unitPath()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(unitPath(), []byte(unit), 0o644); err != nil {
		return err
	}
	for _, args := range [][]string{
		{"--user", "daemon-reload"},
		{"--user", "enable", systemdUnit},
		// restart, not start: a reinstall must pick up the new binary.
		{"--user", "restart", systemdUnit},
	} {
		if err := run("systemctl", args...); err != nil {
			return err
		}
	}
	fmt.Println("installed", unitPath(), "— logs: journalctl --user -u loom-node")

	// Without lingering, a user unit only runs while the user is logged in.
	if err := run("loginctl", "enable-linger"); err != nil {
		fmt.Println("note: could not enable lingering, so loom-node runs only while you are logged in;",
			"`sudo loginctl enable-linger $USER` fixes that")
	}
	return nil
}

// No systemd (WSL without `systemd=true` in /etc/wsl.conf): start it now, in
// the background, and say plainly that it will not come back by itself.
func installDetached(exe string) error {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".local", "state", "loom-node")
	os.MkdirAll(dir, 0o700)
	logFile, err := os.OpenFile(filepath.Join(dir, "daemon.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logFile.Close()

	exec.Command("pkill", "-x", "loom-node").Run()
	cmd := exec.Command(exe, "daemon")
	cmd.Stdout, cmd.Stderr = logFile, logFile
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	fmt.Println("no systemd user session here, so loom-node was started in the background",
		"and will not survive a restart.")
	fmt.Println("on WSL, add `systemd=true` under [boot] in /etc/wsl.conf, run `wsl --shutdown`,",
		"and run this install again to make it permanent.")
	return nil
}

// ── Android / Termux ──────────────────────────────────────────────────────

// Termux has no systemd or launchd. Termux:Boot (a companion app) runs any
// script in ~/.termux/boot/ at device startup — the only startup hook a
// per-user process gets. So installing writes a boot script that holds a
// wake-lock (or Android idles the CPU and drops the socket) and keeps the
// daemon up in a restart loop, then runs that same script now so the device is
// online before the next reboot.
func bootScriptPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".termux", "boot", "loom-node")
}

func installTermux(exe string) error {
	dir := stateDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	logPath := filepath.Join(dir, "daemon.log")

	// A supervisor loop: termux-wake-lock keeps the CPU alive (absent when
	// termux-api is not installed — harmless), and the daemon is relaunched if
	// Android kills it.
	script := fmt.Sprintf(`#!/data/data/com.termux/files/usr/bin/sh
# loom-node, started by Termux:Boot. See loom's Devices.
termux-wake-lock 2>/dev/null || true
while true; do
  '%s' daemon >>'%s' 2>&1
  sleep 5
done
`, exe, logPath)

	if err := os.MkdirAll(filepath.Dir(bootScriptPath()), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(bootScriptPath(), []byte(script), 0o755); err != nil {
		return err
	}

	// A reinstall must replace the running supervisor and daemon, not stack a
	// second one on top; the binary at exe has already been overwritten.
	exec.Command("pkill", "-f", bootScriptPath()).Run()
	exec.Command("pkill", "-x", "loom-node").Run()

	cmd := exec.Command("sh", bootScriptPath())
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}

	fmt.Println("installed", bootScriptPath())
	fmt.Println("loom-node is running; logs in", logPath)
	fmt.Println("install the Termux:Boot app from F-Droid and open it once, so loom-node comes back after a reboot")
	return nil
}

func stopTermux() {
	exec.Command("pkill", "-f", bootScriptPath()).Run()
	exec.Command("pkill", "-x", "loom-node").Run()
	os.Remove(bootScriptPath())
}

// ── uninstall ───────────────────────────────────────────────────────────

func runUninstall(args []string) int {
	switch runtime.GOOS {
	case "darwin":
		exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), launchdLabel)).Run()
		os.Remove(plistPath())
	case "android":
		stopTermux()
	case "linux":
		exec.Command("systemctl", "--user", "disable", "--now", systemdUnit).Run()
		os.Remove(unitPath())
		exec.Command("systemctl", "--user", "daemon-reload").Run()
	case "windows":
		uninstallWindows()
	}
	os.Remove(configPath())
	fmt.Println("loom-node stopped and its service and token removed; remove the device in loom too")
	return 0
}

// selfUninstall is uninstall run by the daemon itself, when loom removed the
// device: the token, the service, the binaries, the logs and the agents'
// scratch space all go, so nothing is left on someone else's machine. Stopping
// the service kills this process on macOS and under systemd, so that is last.
func selfUninstall() int {
	os.RemoveAll(filepath.Dir(configPath()))
	if runtime.GOOS != "windows" { // there the daemon's own log is open; see removeBinaries
		os.RemoveAll(stateDir())
	}
	if exe, err := os.Executable(); err == nil {
		if exe, err = filepath.EvalSymlinks(exe); err == nil {
			removeBinaries(exe)
		}
	}
	switch runtime.GOOS {
	case "darwin":
		os.Remove(plistPath())
		home, _ := os.UserHomeDir()
		os.Remove(filepath.Join(home, "Library", "Logs", "loom-node.log"))
		exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), launchdLabel)).Run()
	case "android":
		// Kill the Termux:Boot supervisor and drop its script, so it does not
		// relaunch us; our own process then exits on return, unsupervised.
		os.Remove(bootScriptPath())
		exec.Command("pkill", "-f", bootScriptPath()).Run()
	case "linux":
		if os.Getenv("INVOCATION_ID") != "" {
			exec.Command("systemctl", "--user", "disable", systemdUnit).Run()
			os.Remove(unitPath())
			exec.Command("systemctl", "--user", "daemon-reload").Run()
			exec.Command("systemctl", "--user", "stop", systemdUnit).Run()
		}
	case "windows":
		removeRunKey()
	}
	return 0
}

// ── Windows ─────────────────────────────────────────────────────────────

// guiCopy marks a PE image as a Windows GUI program: the subsystem field, two
// bytes at offset 68 of the optional header in both PE32 and PE32+.
func guiCopy(b []byte) error {
	if len(b) < 0x40 {
		return errors.New("this binary is not a PE image")
	}
	pe := int(binary.LittleEndian.Uint32(b[0x3c:]))
	at := pe + 4 + 20 + 68
	if pe < 0 || at+2 > len(b) || string(b[pe:pe+4]) != "PE\x00\x00" {
		return errors.New("this binary is not a PE image")
	}
	binary.LittleEndian.PutUint16(b[at:], 2) // IMAGE_SUBSYSTEM_WINDOWS_GUI
	return nil
}
