import fs from "node:fs/promises";
import path from "node:path";
import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixDiskService {
  constructor(private readonly client: BitrixRestClient) {}

  storageList() {
    return this.client.call("disk.storage.getlist", {});
  }

  folderGet(folderId: number) {
    return this.client.call("disk.folder.get", { id: folderId });
  }

  folderChildren(folderId: number) {
    return this.client.call("disk.folder.getchildren", { id: folderId });
  }

  folderCreate(parentFolderId: number, name: string) {
    return this.client.call("disk.folder.addsubfolder", { id: parentFolderId, data: { NAME: name } });
  }

  async folderUploadFile(params: { folderId: number; localPath: string; filename?: string }) {
    const buf = await fs.readFile(params.localPath);
    const filename = params.filename ?? path.basename(params.localPath);
    return this.client.callMultipart(
      "disk.folder.uploadfile",
      {
        id: params.folderId,
        data: { NAME: filename }
      },
      {
        file: { buffer: buf, filename }
      }
    );
  }

  fileGet(fileId: number) {
    return this.client.call("disk.file.get", { id: fileId });
  }

  fileDownloadUrl(fileId: number) {
    return this.client.call("disk.file.getDownloadUrl", { id: fileId });
  }

  move(params: { objectType: "file" | "folder"; objectId: number; targetFolderId: number }) {
    const method =
      params.objectType === "file" ? "disk.file.moveto" : "disk.folder.moveto";
    return this.client.call(method, { id: params.objectId, targetId: params.targetFolderId });
  }

  shareFolderToUser(folderId: number, userId: number, access: string = "R") {
    return this.client.call("disk.folder.sharetouser", { id: folderId, userId, access });
  }
}
