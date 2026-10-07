from fastapi import FastAPI

app = FastAPI()


@app.get("/tareas")
def tareas():
    return []


@app.route("/tareas/sync", methods=["POST", "PUT"])
def sincronizar():
    raise ValueError("no")
