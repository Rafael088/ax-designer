import { db } from "@/lib/db";
import { inicioDelDia, ok } from "@/lib/http";

export async function GET(req: Request) {
  const { searchParams: sp } = new URL(req.url);
  const dias = Math.min(Math.max(parseInt(sp.get("dias") ?? "", 10) || 30, 1), 365);
  const categoria = sp.get("categoria");
  const gastos = await db.gasto.findMany({
    where: { fecha: { gte: inicioDelDia(-(dias - 1)) }, ...(categoria ? { categoria } : {}) },
    orderBy: { fecha: "desc" },
  });
  return ok(gastos);
}
