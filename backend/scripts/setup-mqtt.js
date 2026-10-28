const fs = require("node:fs");
const path = require("node:path");
const file = path.resolve(__dirname, "../.env");
if (!fs.existsSync(file))
  throw new Error("Configure primeiro backend/.env conforme .env.example.");
let content = fs.readFileSync(file, "utf8");
const defaults = {
  MQTT_ENABLED: "true",
  MQTT_TEST_MODE: "true",
  MQTT_URL: "mqtt://test.mosquitto.org:1883",
  MQTT_PREFIX: "senai/mateu-horta-7c91",
};
for (const [name, value] of Object.entries(defaults)) {
  const expression = new RegExp(`^${name}=.*$`, "m");
  if (!expression.test(content)) content += `\n${name}=${value}\n`;
  else if (name === "MQTT_ENABLED")
    content = content.replace(expression, "MQTT_ENABLED=true");
}
fs.writeFileSync(file, content);
console.info(
  "MQTT habilitado em .env; configurações de broker existentes preservadas.",
);
