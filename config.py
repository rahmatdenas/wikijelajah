import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-change-in-production')

    # Wikimedia OAuth2 — daftarkan di meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration
    WIKIMEDIA_CLIENT_ID = os.environ.get('WIKIMEDIA_CLIENT_ID')
    WIKIMEDIA_CLIENT_SECRET = os.environ.get('WIKIMEDIA_CLIENT_SECRET')
    WIKIMEDIA_ACCESS_TOKEN = os.environ.get('WIKIMEDIA_ACCESS_TOKEN')
    WIKIMEDIA_USER_AGENT = os.environ.get('WIKIMEDIA_USER_AGENT', 'WikiJelajah/1.0')
    WIKIMEDIA_OAUTH_BASE = 'https://meta.wikimedia.org/w/rest.php/oauth2'
    WIKIMEDIA_PROFILE_URL = 'https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile'
    WIKIMEDIA_API_BASE = 'https://www.wikidata.org/w/api.php'
    WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

    APP_NAME = 'WikiJelajah'
    APP_TAGLINE = 'Visualisasi Wikidata Interaktif'


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}
