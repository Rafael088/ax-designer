import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { orden = "nombre", activos } = Object.fromEntries(searchParams);
  const productos = await db.producto.findMany({
    where: activos === "1" ? { activo: true } : undefined,
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json(productos.map((x) => ({ ...x, orden, disponible: x.activo })));
}
