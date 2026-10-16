"""Single-worker entry point for local and Alternate Clouds deployment."""
import os
import uvicorn
from dotenv import load_dotenv

if __name__ == '__main__':
    load_dotenv()
    uvicorn.run('backend.main:app', host='0.0.0.0', port=int(os.getenv('PORT', '8000')), workers=1)
