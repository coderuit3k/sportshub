import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { prisma } from "@/lib/db";
import { canJoinSession } from "@/lib/booking/logic";

export async function changeSessionParticipation(
  sessionId: string,
  userId: string,
  action: "join" | "leave",
  db: PrismaClient = prisma,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const session = await tx.sportsSession.findUnique({ where: { id: sessionId } });
        if (!session) throw new Error("SESSION_NOT_FOUND");

        if (action === "leave") {
          await tx.sessionParticipant.deleteMany({ where: { sessionId, userId } });
          const joinedCount = await tx.sessionParticipant.count({ where: { sessionId, status: "JOINED" } });
          if (session.status === "FULL" && joinedCount < session.maxParticipants) {
            await tx.sportsSession.update({ where: { id: sessionId }, data: { status: "OPEN" } });
          }
          return { joined: false, session };
        }

        if (session.status !== "OPEN" && session.status !== "FULL") throw new Error("SESSION_CLOSED");
        const existing = await tx.sessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
        if (existing?.status === "JOINED") throw new Error("SESSION_ALREADY_JOINED");
        const joinedCount = await tx.sessionParticipant.count({ where: { sessionId, status: "JOINED" } });
        if (!canJoinSession(joinedCount, session.maxParticipants)) throw new Error("SESSION_FULL");
        await tx.sessionParticipant.upsert({
          where: { sessionId_userId: { sessionId, userId } },
          create: { sessionId, userId, status: "JOINED" },
          update: { status: "JOINED" },
        });
        const status = joinedCount + 1 >= session.maxParticipants ? "FULL" : "OPEN";
        if (session.status !== status) await tx.sportsSession.update({ where: { id: sessionId }, data: { status } });
        return { joined: true, session };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034") throw error;
      if (attempt === 2) throw new Error("SESSION_BUSY");
    }
  }
  throw new Error("SESSION_BUSY");
}
