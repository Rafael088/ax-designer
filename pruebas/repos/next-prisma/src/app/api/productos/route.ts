import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const esquemaProducto = z.object({
  nombre: z.string().trim().min(2),
  precio: z.number().nonnegative(),
  stock: z.number().int().optional(),
  // Una lista de etiquetas, cada una opcional por dentro: el campo sigue siendo requerido.
  etiquetas: z.array(z.string().optional()),
  categoriaId: z.number().int().positive(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoria = searchParams.get("categoria");
  const productos = await prisma.producto.findMany({ where: categoria ? { categoriaId: Number(categoria) } : {} });
  return NextResponse.json({ data: productos, error: null });
}

export async function POST(request: Request) {
  const resultado = esquemaProducto.safeParse(await request.json());
  if (!resultado.success) {
    return NextResponse.json({ data: null, error: "Datos inválidos" }, { status: 400 });
  }
  const producto = await prisma.producto.create({ data: resultado.data });
  return NextResponse.json({ data: producto, error: null }, { status: 201 });
}
