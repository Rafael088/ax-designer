import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";

const consultaSchema = z.object({
  q: z.string().min(2),
  pagina: z.coerce.number().int().min(1).default(1),
  tamano: z.coerce.number().int().max(50).default(20),
  tipo: z.enum(["producto", "pedido"]).optional(),
});

export async function GET(req: Request) {
  const consulta = consultaSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const resultados = await db.producto.findMany({ where: { nombre: { contains: consulta.q } }, take: consulta.tamano });
  return ok({ resultados, pagina: consulta.pagina });
}
