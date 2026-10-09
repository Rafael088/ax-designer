import { db } from "@/lib/db";
import { inicioDelDia, ok } from "@/lib/http";

/** Lo que muestra la portada del panel, en una sola lectura. */
export async function GET() {
  const hoy = inicioDelDia();
  const manana = inicioDelDia(1);
  const ayer = inicioDelDia(-1);
  const inicioSemana = inicioDelDia(-6);
  const inicioMes = inicioDelDia(-29);

  const [pedidos, masVendidos, facturas] = await Promise.all([
    db.pedido.findMany({ where: { fecha: { gte: inicioMes } }, select: { fecha: true, total: true } }),
    db.pedidoItem.groupBy({
      by: ["productoId"],
      where: { pedido: { fecha: { gte: inicioMes } } },
      _sum: { cantidad: true },
      orderBy: { _sum: { cantidad: "desc" } },
      take: 5,
    }),
    db.factura.findMany({ where: { pagada: false }, orderBy: { vence: "asc" } }),
  ]);

  const suma = (desde: Date, hasta: Date) => pedidos.filter((p) => p.fecha >= desde && p.fecha < hasta).reduce((s, p) => s + p.total, 0);
  const ventasHoy = suma(hoy, manana);
  const ventasAyer = suma(ayer, hoy);
  const ventasSemana = suma(inicioSemana, manana);
  const vencidas = facturas.filter((f) => f.vence < hoy);

  return ok({
    ventas: { hoy: ventasHoy, ayer: ventasAyer, semana: ventasSemana },
    masVendidos,
    facturas: { vencidas: { cantidad: vencidas.length, lista: vencidas } },
  });
}
