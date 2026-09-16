"""Fetch SEC facts sequentially; normalize via Node. Run from repository root.
One request at a time, <=2/sec, 25s timeout, no retries on denial/rate limits.
Raw files stay outside git; existing published data is never destroyed on failure.
"""
import json, os, pathlib, subprocess, tempfile, time, urllib.request
SYMBOLS = ['MSFT','GOOGL','KO','NVDA','AVGO','ETN','GEV','VRT','CCJ','ORCL']
HEADERS = {'User-Agent': os.environ.get('SEC_USER_AGENT', 'LaoFanStudioResearch/0.1 (https://github.com/LaoFan199/laofan-studio)')}
def fetch(url):
    time.sleep(.6)
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=25) as response:
        return json.load(response)

def main():
    mapping = {x['ticker']: x['cik_str'] for x in fetch('https://www.sec.gov/files/company_tickers.json').values()}
    # Identity mapping must succeed first. Each company's failure is independent.
    with tempfile.TemporaryDirectory(prefix='laofan-sec-') as tmp:
        for symbol in SYMBOLS:
            try:
                cik = mapping[symbol]
                raw = fetch(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json')
                if int(raw.get('cik', -1)) != cik: raise ValueError('SEC identity mismatch')
                pathlib.Path(tmp, symbol+'.json').write_text(json.dumps(raw))
                print(symbol, 'downloaded', flush=True)
            except Exception as exc:
                print(symbol, 'unavailable:', type(exc).__name__, flush=True)
        subprocess.run(['node','scripts/pack-financials.mjs',tmp],check=True)
if __name__ == '__main__': main()
