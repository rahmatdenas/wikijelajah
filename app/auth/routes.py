from flask import current_app, redirect, request, session, url_for
from requests import get as requests_get
from . import auth


@auth.route('/login')
def login():
    access_token = current_app.config.get('WIKIMEDIA_ACCESS_TOKEN')
    ua = current_app.config.get('WIKIMEDIA_USER_AGENT', 'WikiJelajah/1.0')

    profile_resp = requests_get(
        current_app.config['WIKIMEDIA_PROFILE_URL'],
        headers={
            'Authorization': f'Bearer {access_token}',
            'User-Agent': ua,
            'Accept': 'application/json',
        },
        timeout=10,
    )
    profile = profile_resp.json() if profile_resp.ok else {}

    session['oauth_token'] = {'access_token': access_token, 'token_type': 'Bearer'}
    session['user'] = {
        'username': profile.get('username', 'Unknown'),
        'editcount': profile.get('editcount', 0),
    }

    # Kembali ke halaman asal; hanya path lokal agar tidak jadi open redirect
    next_url = request.args.get('next', '')
    if not next_url.startswith('/') or next_url.startswith(('//', '/\\')):
        next_url = url_for('main.index')
    return redirect(next_url)


@auth.route('/logout')
def logout():
    session.pop('oauth_token', None)
    session.pop('user', None)
    return redirect(url_for('main.index'))
