#!/usr/bin/env python3
"""CLI de mentira: resumen, lista y detalle con verbos en español que no son
«listar»/«list» ni «detalle»/«obtener»/«get-»/«leer-»/«show»."""
import argparse
import json
import sys


def analizador():
    partes = argparse.ArgumentParser(prog="cli-verbos-es")
    sub = partes.add_subparsers(dest="comando", required=True)

    sub.add_parser("estado", help="Resumen con los conteos")

    # Envuelto a dos líneas, como lo deja black con una ayuda larga: el nombre entre
    # comillas queda en la línea siguiente a `add_parser(`.
    buscar = sub.add_parser(
        "buscar", help="Las entradas, filtrables")
    buscar.add_argument("--proyecto", help="Filtra por proyecto")
    buscar.add_argument("--estado", help="Filtra por estado")
    buscar.add_argument("--limite", type=int, default=50, help="Cuántas devolver como mucho")

    leer = sub.add_parser(
        "leer", help="Una entrada completa, por id")
    leer.add_argument("id", help="El id de la entrada")

    return partes


def main(argv=None):
    args = analizador().parse_args(argv)
    if args.comando == "estado":
        print(json.dumps({"esquema": 1, "total": 2}))
        return 0
    if args.comando == "buscar":
        print(json.dumps({"esquema": 1, "entradas": []}))
        return 0
    if args.comando == "leer":
        print(json.dumps({"esquema": 1, "id": args.id}))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
