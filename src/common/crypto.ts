import crypto from "node:crypto";
import { AppError } from "./errors.js";

function getKey(keyBase64: string): Buffer {
  if (!keyBase64) throw new AppError("APP_ENCRYPTION_KEY_BASE64 is required for OAuth token storage", "CONFIG");
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new AppError("APP_ENCRYPTION_KEY_BASE64 must decode to 32 bytes", "CONFIG");
  return key;
}

export function encryptString(plain: string, keyBase64: string): string {
  const key = getKey(keyBase64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptString(enc: string, keyBase64: string): string {
  const raw = Buffer.from(enc, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const key = getKey(keyBase64);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

