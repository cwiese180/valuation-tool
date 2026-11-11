"use strict";
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} = require("node:fs");
const { join } = require("node:path");
const {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");
const { hash } = require("./store");
class FileVault {
  constructor(directory, key) {
    if (!Buffer.isBuffer(key) || key.length !== 32)
      throw Error("Document vault requires 32-byte encryption key");
    this.directory = directory;
    this.key = key;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  put(tenant, bytes) {
    const ref = hash(tenant + ":" + hash(bytes.toString("base64"))),
      path = join(this.directory, ref + ".blob");
    if (!existsSync(path)) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(tenant + ":" + ref));
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
      writeFileSync(path, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {
        mode: 0o600,
        flag: "wx",
      });
    }
    return ref;
  }
  read(tenant, ref) {
    if (!/^[a-f0-9]{64}$/.test(ref)) throw Error("Invalid document reference");
    const blob = readFileSync(join(this.directory, ref + ".blob")),
      decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        blob.subarray(0, 12),
      );
    decipher.setAAD(Buffer.from(tenant + ":" + ref));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([
      decipher.update(blob.subarray(28)),
      decipher.final(),
    ]);
  }
}
module.exports = { FileVault };
