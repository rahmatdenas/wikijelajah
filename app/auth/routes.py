from flask import current_app, redirect, request, session, url_for
from requests import get as requests_get
from requests_oauthlib import OAuth2Session
from . import auth


def _safe_next(next_url):
    """Hanya path lokal agar tidak jadi open redirect."""
    if not next_url or not next_url.startswith('/') or next_url.startswith(('//', '/\\')):
        return url_for('main.index')
    return next_url


def _oauth_session(**kwargs):
    return OAuth2Session(
        client_id=current_app.config['WIKIMEDIA_CLIENT_ID'],
        redirect_uri=url_for('auth.callback', _external=True),
        **kwargs,
    )


def _login_with_token(token, next_url):
    """Ambil profil pemilik token, simpan ke sesi, lalu kembali ke halaman asal."""
    profile_resp = requests_get(
        current_app.config['WIKIMEDIA_PROFILE_URL'],
        headers={
            'Authorization': f"Bearer {token['access_token']}",
            'User-Agent': current_app.config.get('WIKIMEDIA_USER_AGENT', 'WikiJelajah/1.0'),
            'Accept': 'application/json',
        },
        timeout=10,
    )
    profile = profile_resp.json() if profile_resp.ok else {}

    session['oauth_token'] = token
    session['user'] = {
        'username': profile.get('username', 'Unknown'),
        'editcount': profile.get('editcount', 0),
    }
    return redirect(_safe_next(next_url))


@auth.route('/login')
def login():
    next_url = request.args.get('next', '')

    # Pengembangan lokal: token akses statis dari .env, tanpa alur OAuth
    access_token = current_app.config.get('WIKIMEDIA_ACCESS_TOKEN')
    if access_token:
        return _login_with_token({'access_token': access_token, 'token_type': 'Bearer'}, next_url)

    # Alur OAuth 2.0 per pengguna: arahkan ke meta.wikimedia.org untuk izin
    authorize_url, state = _oauth_session().authorization_url(
        f"{current_app.config['WIKIMEDIA_OAUTH_BASE']}/authorize")
    session['oauth_state'] = state
    session['oauth_next'] = next_url
    return redirect(authorize_url)


@auth.route('/callback')
def callback():
    state = session.pop('oauth_state', None)
    next_url = session.pop('oauth_next', '')
    if not state or request.args.get('state') != state:
        return redirect(url_for('main.index'))
    if 'error' in request.args or 'code' not in request.args:
        # Pengguna menolak izin atau meta mengembalikan galat
        return redirect(_safe_next(next_url))

    token = _oauth_session(state=state).fetch_token(
        f"{current_app.config['WIKIMEDIA_OAUTH_BASE']}/access_token",
        client_secret=current_app.config['WIKIMEDIA_CLIENT_SECRET'],
        code=request.args['code'],
        include_client_id=True,
    )
    # Simpan seperlunya: sesi Flask ada di cookie (batas ~4 KB)
    return _login_with_token({'access_token': token['access_token'], 'token_type': 'Bearer'}, next_url)


@auth.route('/logout')
def logout():
    session.pop('oauth_token', None)
    session.pop('user', None)
    return redirect(url_for('main.index'))
