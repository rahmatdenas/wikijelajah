import os
from app import create_app  # noqa: E402 (dotenv loaded in config)

app = create_app(os.environ.get('FLASK_ENV', 'default'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port)
