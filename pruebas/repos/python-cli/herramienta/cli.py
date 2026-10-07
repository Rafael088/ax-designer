import json
import os
import sys

import click

from . import almacen
from .almacen import leer


@click.group()
def cli():
    pass


@cli.command()
def listar_tareas():
    click.echo(json.dumps({"schema_version": 1, "tareas": leer()}))


@cli.command("entregar")
@click.option("--dry-run", is_flag=True)
def entregar(dry_run):
    try:
        almacen.guardar(dry_run)
    except Exception:
        pass
    except OSError: return []
    sys.exit(3)


def main():
    cli()


if __name__ == "__main__":
    main()
