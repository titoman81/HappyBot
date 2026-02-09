import sys
try:
    import whisper
except Exception as e:
    print('ERROR: missing whisper package. Install with `pip install -U openai-whisper`', file=sys.stderr)
    sys.exit(2)

def main():
    if len(sys.argv) < 2:
        print('', end='')
        return
    audio = sys.argv[1]
    try:
        model = whisper.load_model('small')
        res = model.transcribe(audio)
        text = res.get('text', '').strip()
        print(text)
    except Exception as e:
        print('', end='')

if __name__ == '__main__':
    main()
