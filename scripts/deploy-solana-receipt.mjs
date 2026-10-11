import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const programId = new PublicKey(process.argv[2]);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const genesis = await connection.getGenesisHash();
if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Devnet genesis mismatch");
const account = await connection.getAccountInfo(programId);
if (!account?.executable) throw new Error("Program is not deployed and executable");
const programDataId = new PublicKey(account.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataId);
if (!programData || programData.data.readUInt32LE(0) !== 3) throw new Error("Upgradeable program data missing");
const upgradeAuthority = programData.data[12] === 1 ? new PublicKey(programData.data.subarray(13, 45)).toBase58() : null;
const signatures = await connection.getSignaturesForAddress(programId, { limit: 5 });
const latest = signatures.find((receipt) => receipt.err === null);
if (!latest) throw new Error("No successful deployment transaction receipt");
const binary = await readFile("chain/deploy/geo_duels.so");
const sha256 = createHash("sha256").update(binary).digest("hex");
const receipt = {
  network: "devnet", genesis, programId: programId.toBase58(), executable: true,
  programDataId: programDataId.toBase58(), upgradeAuthority,
  sponsor: "https://deployer.devnet.solana.com", idleRetentionDays: 7,
  registeredUpgradeOwner: "DH64ZBM8LBPp4RSss6vkz3JWJ4h5HuL4ULsnx3pqjmHQ",
  refereePublicKey: "6HzMz4vsXsSko7e2y3PkL2fuEdRGkpPjSyJDyp6XcT4P",
  deploySignature: latest.signature, deploySlot: latest.slot, deployBlockTime: latest.blockTime,
  binaryBytes: binary.length, binarySha256: sha256,
  verifiedAt: new Date().toISOString(),
  fundedDevnetRoundVerified: false,
};
await writeFile("chain/deployment.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
