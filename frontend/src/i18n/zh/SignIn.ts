// SignIn.tsx: Settings → Sign-in (passkeys, the devices signed in), and the
// request another device's password sign-in puts on this one.
export default {
  never: "从未",
  "{n}h ago": "{n} 小时前",
  "{n}d ago": "{n} 天前",
  // How a device signed in.
  "password, allowed on {name}": "密码，由 {name} 批准",
  "passkey made on {name}": "在 {name} 上创建的 passkey",
  passkey: "passkey",
  Passkeys: "Passkey",
  "Face ID, Touch ID, Windows Hello or an Android screen lock signs in at once. Without one, the password has to be allowed on a device already signed in.":
    "用 Face ID、Touch ID、Windows Hello 或安卓锁屏一步登录。没有 passkey 时，输入密码后还要在一台已登录的设备上批准。",
  "used {when}": "上次使用：{when}",
  "Remove passkey": "删除 passkey",
  "Remove the passkey made on {name}? Delete it from that device's passwords too.":
    "删除在 {name} 上创建的 passkey？记得在那台设备的密码管理里也把它删掉。",
  "Password, to confirm": "再输一次密码以确认",
  "Add a passkey on this device": "在这台设备上添加 passkey",
  "This browser can't make passkeys.": "这个浏览器不支持创建 passkey。",
  "Signed-in devices": "已登录的设备",
  "Each signs out after {n} days unused. A device shows up here the next time it opens Loom.":
    "{n} 天不用自动登出。设备下次打开 Loom 后会出现在这里。",
  "This device": "本机",
  "Sign this device out?": "登出这台设备？",
  "Sign {name} out?": "登出 {name}？",
  "Sign out": "登出",
  "Sign-in request": "登录请求",
  " from {ip} entered the right password and wants to sign in.": "（来自 {ip}）输对了密码，请求登录。",
  " entered the right password and wants to sign in.": " 输对了密码，请求登录。",
  "Only allow it if it's you, on that device, right now.": "只有确认是你本人此刻正在那台设备上操作，才点允许。",
  Deny: "拒绝",
  Allow: "允许",
} satisfies Record<string, string>
