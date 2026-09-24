from flask import current_app, redirect, session, url_for
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

    return redirect(url_for('main.index'))


@auth.route('/logout')
def logout():
    session.pop('oauth_token', None)
    session.pop('user', None)
    return redirect(url_for('main.index'))
