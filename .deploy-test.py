import json, subprocess, time, urllib.request, base64

REPO = "yousungcake-wq/webpost"
SITE = "https://yousungcake-wq.github.io/webpost/posts.json"
API = f"https://api.github.com/repos/{REPO}/contents/posts.json"


def gh(args, body=None):
    cmd = ["gh", "api"] + args
    if body is not None:
        cmd += ["--input", "-"]
    p = subprocess.run(cmd, input=json.dumps(body).encode() if body is not None else None,
                       capture_output=True)
    if p.returncode != 0:
        raise SystemExit("gh failed: " + p.stderr.decode()[:300])
    out = p.stdout.decode().strip()
    return json.loads(out) if out else None


def live_posts():
    # 사이트가 글을 받아오는 방식과 같게(캐시 무력화 쿼리) 확인한다
    url = SITE + "?ts=" + str(int(time.time() * 1000))
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read().decode())


cur = gh([API])
sha = cur["sha"]
posts = json.loads(base64.b64decode(cur["content"]).decode())
orig = json.loads(json.dumps(posts))
print("현재 글:", len(posts), "sha:", sha[:8])

test = {
    "id": "cms-path-test",
    "d": "2026-11-24",
    "t": "쓰기 경로 테스트",
    "b": "브라우저 대신 같은 모양의 PUT 으로 올려 본 글. 곧 지운다.",
    "c": int(time.time() * 1000),
    "u": 0,
}
posts.append(test)
posts.sort(key=lambda p: (p["d"], p.get("c", 0)), reverse=True)

t0 = time.time()
gh(["-X", "PUT", API],
   {"message": "WebPost: 새 글 — 쓰기 경로 테스트", "branch": "main",
    "content": base64.b64encode((json.dumps(posts, ensure_ascii=False, indent=2) + "\n").encode()).decode(),
    "sha": sha})
print("커밋 완료")

shown = None
for i in range(40):
    time.sleep(5)
    try:
        live = live_posts()
    except Exception as e:
        print("  조회 실패", e)
        continue
    if any(p.get("id") == "cms-path-test" for p in live):
        shown = time.time() - t0
        print(f"사이트 반영까지 {shown:.0f}초 (폴링 {i+1}회)")
        break
else:
    print("!! 40회(200초) 안에 반영 안 됨")

# 되돌리기 — 테스트 글 삭제
cur2 = gh([API])
gh(["-X", "PUT", API],
   {"message": "WebPost: 테스트 글 삭제", "branch": "main",
    "content": base64.b64encode((json.dumps(orig, ensure_ascii=False, indent=2) + "\n").encode()).decode(),
    "sha": cur2["sha"]})
print("삭제 커밋 완료")

t1 = time.time()
for i in range(40):
    time.sleep(5)
    try:
        live = live_posts()
    except Exception:
        continue
    if not any(p.get("id") == "cms-path-test" for p in live):
        print(f"삭제 반영까지 {time.time()-t1:.0f}초, 남은 글 {len(live)}편")
        break
else:
    print("!! 삭제가 200초 안에 반영 안 됨")
