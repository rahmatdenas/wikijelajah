import os
from dotenv import load_dotenv

load_dotenv()


DEV_SECRET_KEY = 'dev-secret-change-in-production'


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or DEV_SECRET_KEY

    # Wikimedia OAuth2 — daftarkan di meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration
    WIKIMEDIA_CLIENT_ID = os.environ.get('WIKIMEDIA_CLIENT_ID')
    WIKIMEDIA_CLIENT_SECRET = os.environ.get('WIKIMEDIA_CLIENT_SECRET')
    WIKIMEDIA_ACCESS_TOKEN = os.environ.get('WIKIMEDIA_ACCESS_TOKEN')
    WIKIMEDIA_USER_AGENT = os.environ.get('WIKIMEDIA_USER_AGENT', 'WikiJelajah/1.0')
    WIKIMEDIA_OAUTH_BASE = 'https://meta.wikimedia.org/w/rest.php/oauth2'
    WIKIMEDIA_PROFILE_URL = 'https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile'
    WIKIMEDIA_API_BASE = 'https://www.wikidata.org/w/api.php'
    WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

    # Folder data persisten (SQLite Perkaya). Toolforge mengisi TOOL_DATA_DIR otomatis;
    # di lokal kosong sehingga memakai folder instance/ seperti biasa.
    DATA_DIR = os.environ.get('DATA_DIR') or os.environ.get('TOOL_DATA_DIR')

    APP_NAME = 'WikiJelajah'
    APP_TAGLINE = 'Visualisasi Wikidata Interaktif'


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    PREFERRED_URL_SCHEME = 'https'


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}
