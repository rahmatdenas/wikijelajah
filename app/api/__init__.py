from flask import Blueprint

api = Blueprint('api', __name__)

from . import routes, enrich, favorites  # noqa: F401, E402
