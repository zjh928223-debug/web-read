import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--release-id', required=True)
parser.add_argument('--profile-id', required=True)
parser.add_argument('--instance-id', required=True)
parser.add_argument('--ready-delay', type=float, default=0)
args = parser.parse_args()
started = time.monotonic()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health':
            self.send_response(404)
            self.end_headers()
            return
        ready = time.monotonic() - started >= args.ready_delay
        body = json.dumps({
            'status': 'ready' if ready else 'starting',
            'releaseId': args.release_id,
            'profileId': args.profile_id,
            'instanceId': args.instance_id,
        }).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass

ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
