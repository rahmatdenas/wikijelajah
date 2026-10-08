from flask import Blueprint

api = Blueprint('api', __name__)

from . import routes, perkaya  # noqa: F401, E402
