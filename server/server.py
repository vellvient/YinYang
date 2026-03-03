"""
YinYang YouTube Transcript Server
Fetches Chinese subtitles/transcripts from YouTube videos
for comprehension analysis.
"""

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
import re
import json
import time
import random

app = Flask(__name__)
CORS(app)


def extract_video_id(url):
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'  # Raw video ID
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_chinese_transcript(video_id):
    """Fetch Chinese transcript for a video. Returns (text, language) or raises."""
    ytt_api = YouTubeTranscriptApi()
    transcript_list = ytt_api.list(video_id)

    transcript_obj = None
    language_used = None
    chinese_codes = ['zh', 'zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW']

    try:
        transcript_obj = transcript_list.find_manually_created_transcript(chinese_codes)
        language_used = transcript_obj.language_code + ' (manual)'
    except Exception:
        pass

    if transcript_obj is None:
        try:
            transcript_obj = transcript_list.find_generated_transcript(chinese_codes)
            language_used = transcript_obj.language_code + ' (auto)'
        except Exception:
            pass

    if transcript_obj is None:
        raise ValueError("No Chinese subtitles available")

    fetched = transcript_obj.fetch()
    parts = []
    for snippet in fetched:
        text = snippet.text if hasattr(snippet, 'text') else snippet.get('text', '')
        parts.append(text)

    full_text = ' '.join(parts)
    full_text = re.sub(r'\[.*?\]', '', full_text)
    full_text = re.sub(r'\s+', ' ', full_text).strip()

    return full_text, language_used, len(parts)


@app.route('/api/transcript', methods=['POST'])
def get_transcript():
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'Missing "url" in request body'}), 400

    video_id = extract_video_id(data['url'])
    if not video_id:
        return jsonify({'error': 'Could not extract video ID from URL'}), 400

    try:
        full_text, language_used, segment_count = fetch_chinese_transcript(video_id)
        return jsonify({
            'video_id': video_id,
            'language': language_used,
            'transcript': full_text,
            'segment_count': segment_count
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': f'Failed to fetch transcript: {str(e)}'}), 500


@app.route('/api/playlist', methods=['POST'])
def analyze_playlist():
    """
    Stream SSE events while analyzing a playlist.
    Anti-blocking: uses yt-dlp for playlist extraction + random delays between transcript requests.
    """
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'Missing "url" in request body'}), 400

    playlist_url = data['url']
    limit = min(int(data.get('limit', 20)), 50)  # cap at 50

    def generate():
        # --- Step 1: Extract playlist video IDs via yt-dlp ---
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': True,          # Don't download, just list
                'playlist_items': f'1-{limit}',
                'ignoreerrors': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(playlist_url, download=False)

            if not info or 'entries' not in info:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Could not read playlist. Check the URL and try again.'})}\n\n"
                return

            entries = [e for e in info['entries'] if e and e.get('id')]
            total = len(entries)
            playlist_title = info.get('title', 'Playlist')

            yield f"data: {json.dumps({'type': 'start', 'total': total, 'playlist_title': playlist_title})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to load playlist: {str(e)}'})}\n\n"
            return

        # --- Step 2: Analyze each video sequentially with random delays ---
        results = []
        for i, entry in enumerate(entries):
            video_id = entry.get('id')
            title = entry.get('title', f'Video {i+1}')

            yield f"data: {json.dumps({'type': 'progress', 'index': i, 'total': total, 'title': title})}\n\n"

            try:
                transcript, language, seg_count = fetch_chinese_transcript(video_id)
                results.append({
                    'video_id': video_id,
                    'title': title,
                    'transcript': transcript,
                    'language': language,
                    'segment_count': seg_count,
                    'status': 'ok'
                })
                yield f"data: {json.dumps({'type': 'video_done', 'index': i, 'video_id': video_id, 'title': title, 'status': 'ok'})}\n\n"
            except Exception as ex:
                results.append({
                    'video_id': video_id,
                    'title': title,
                    'status': 'no_subs',
                    'error': str(ex)
                })
                yield f"data: {json.dumps({'type': 'video_done', 'index': i, 'video_id': video_id, 'title': title, 'status': 'no_subs'})}\n\n"

            # Anti-blocking: random delay between requests (skip delay after last video)
            if i < total - 1:
                # Base delay: 3–6 seconds between every request
                delay = random.uniform(3.0, 6.0)
                # Extra cooldown every 5 videos to avoid sustained rate pressure
                if (i + 1) % 5 == 0:
                    delay += random.uniform(8.0, 12.0)
                    yield f"data: {json.dumps({'type': 'cooldown', 'seconds': round(delay)})}\n\n"
                time.sleep(delay)


        # --- Step 3: Send all transcripts in one final event for client-side scoring ---
        ok_results = [r for r in results if r['status'] == 'ok']
        yield f"data: {json.dumps({'type': 'done', 'results': ok_results, 'total_ok': len(ok_results), 'total': total})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        }
    )


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'yinyang-transcript'})


if __name__ == '__main__':
    print("YinYang Transcript Server starting on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
