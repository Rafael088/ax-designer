import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const esquemaCambio = z.object({
  nombre: z.string(),
  precio: z.number(),
}).partial();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const producto = await prisma.producto.findUnique({ where: { id: Number(id) } });
  if (!producto) return NextResponse.json({ data: null, error: "Producto no encontrado" }, { status: 404 });
  return NextResponse.json({ data: producto, error: null });
}

export const PATCH = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const cambio = esquemaCambio.parse(await request.json());
  const producto = await prisma.producto.update({ where: { id: Number(id) }, data: cambio });
  return NextResponse.json({ data: producto, error: null });
};

async function borrar(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await prisma.producto.delete({ where: { id: Number(id) } });
  return new Response(null, { status: 204 });
}

export { borrar as DELETE };
