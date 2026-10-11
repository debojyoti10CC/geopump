import type { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/** Read-only recovery: never submit or retry a payout to obtain its receipt. */
export async function findConfirmedTerminalReceipt(args: {
  connection: Connection; programId: PublicKey; roomAddress: PublicKey; terminalState: 3 | 4; transcriptDigest?: Uint8Array;
}): Promise<string | null> {
  const candidates=await args.connection.getSignaturesForAddress(args.roomAddress,{limit:20},"confirmed");
  for (const candidate of candidates) {
    if (candidate.err || !["confirmed","finalized"].includes(candidate.confirmationStatus||"")) continue;
    const transaction=await args.connection.getParsedTransaction(candidate.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0});
    if (!transaction || transaction.meta?.err!==null) continue;
    const matches=transaction.transaction.message.instructions.some(instruction=>{
      if (!("data" in instruction) || !instruction.programId.equals(args.programId) || !instruction.accounts[0]?.equals(args.roomAddress)) return false;
      let data:Uint8Array;
      try { data=bs58.decode(instruction.data); } catch { return false; }
      if (args.terminalState===4) return data.length===1 && (data[0]===4 || data[0]===5);
      if (data.length!==106 || data[0]!==3) return false;
      return !args.transcriptDigest || data.subarray(74,106).every((byte,index)=>byte===args.transcriptDigest![index]);
    });
    if (matches) return candidate.signature;
  }
  return null;
}
