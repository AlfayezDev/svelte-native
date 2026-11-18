// Run by plain `node`: the push sender is imported by its export (the file in `dist/node`, which Node loads from a `node_modules`) and sends one message to a local stand-in for
// Google (its token endpoint and FCM), with a service account whose key is made here.
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { createPush } from "@alfayez/svelte-native/push/server";
import * as server from "@alfayez/svelte-native/push/server";

const google = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url === "/token" ? { access_token: "token", expires_in: 3600 } : { name: "projects/p/messages/0:1%abc" }));
  });
});
await new Promise((resolve) => google.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${google.address().port}`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const push = createPush({ fcm: { serviceAccount: { project_id: "p", client_email: "a@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, baseUrl: url, tokenUrl: `${url}/token` } });
const result = await push.send({ provider: "fcm", token: "t", app: "io.example.app" }, { title: "Hello", url: "/orders/42" });
await push.close();
google.close();
console.log(JSON.stringify({ exports: Object.keys(server), result }));
