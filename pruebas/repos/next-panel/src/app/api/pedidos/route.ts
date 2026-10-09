import { z } from "zod";
import { db } from "@/lib/db";
import { leerCuerpo, ok } from "@/lib/http";

const pedidoSchema = z.object({
  items: z.array(z.object({ productoId: z.number().int().positive(), cantidad: z.number().int().min(1).max(50) })).min(1),
  nota: z.string().max(140).optional(),
  canal: z.enum(["mesa", "domicilio"]).default("mesa"),
});

// Los últimos pedidos, del más reciente al más viejo.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const limite = Math.min(Math.max(Number(p.get("limite")) || 30, 1), 200);
  const pedidos = await db.pedido.findMany({
    orderBy: { fecha: "desc" },
    take: limite,
    include: { items: true },
  });
  return ok(pedidos);
}

export async function POST(req: Request) {
  const r = await leerCuerpo(req, pedidoSchema);
  if ("error" in r) return r.error;
  const pedido = await db.pedido.create({ data: { fecha: new Date(), total: 0 } });
  return ok(pedido, 201);
}
