import { ensureNodePtySpawnHelper } from "../electron/node-pty-helper.mjs";

const helper = ensureNodePtySpawnHelper();
if (helper) console.log(`Verified node-pty spawn helper: ${helper}`);
