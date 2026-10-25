from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix
from config import DEV_SECRET_KEY, config


def create_app(config_name='default'):
    app = Flask(__name__)
    app.config.from_object(config.get(config_name, config['default']))

    if not app.debug:
        if app.config['SECRET_KEY'] == DEV_SECRET_KEY:
            raise RuntimeError('SECRET_KEY wajib diisi di lingkungan produksi')
        # Di Toolforge aplikasi berada di belakang proxy HTTPS; tanpa ini url_for
        # membuat tautan http:// dan callback OAuth tidak cocok.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    from . import i18n
    i18n.init_app(app)

    from .auth import auth as auth_bp
    app.register_blueprint(auth_bp, url_prefix='/oauth')

    from .main import main as main_bp
    app.register_blueprint(main_bp)

    from .api import api as api_bp
    app.register_blueprint(api_bp, url_prefix='/api')

    from .utils.enrich_store import close_db
    app.teardown_appcontext(close_db)

    return app
