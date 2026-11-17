"""Parse 一般行政 法學大意 / 行政學大意 exam PDFs into the site's JSON format.

Reads <repo_root>/<年>年公務人員初等考試/一般行政/<年>_<科目>_試題.pdf plus the
matching 更正答案.pdf (or 答案.pdf when no corrected key exists), and writes
<out_dir>/<年>/<科目>.json. Corrections in the answer sheet's 備註 line become
acceptedAnswers / answerRevised. Prints one line per exam; anything after
"PROBLEMS:" needs a manual look.

Requires PyMuPDF (pip install pymupdf).

Usage, from the repo root:
    python -I -X utf8 scripts/parse_general_admin.py . data
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

LABELS = {"": "A", "": "B", "": "C", "": "D"}
SUBJECTS = {"法學大意": "law", "行政學大意": "public-admin"}
FULLWIDTH = str.maketrans("ＡＢＣＤ", "ABCD")


def rows_of(page):
    """Visual rows: spans grouped by baseline, sorted left to right."""
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                if span["text"].strip() == "":
                    continue
                x0, y0, x1, y1 = span["bbox"]
                spans.append({"x0": x0, "x1": x1, "y": (y0 + y1) / 2, "top": y0,
                              "text": span["text"], "font": span["font"]})
    spans.sort(key=lambda s: (s["y"], s["x0"]))
    rows = []
    for span in spans:
        if rows and abs(rows[-1][0]["y"] - span["y"]) < 3.5:
            rows[-1].append(span)
        else:
            rows.append([span])
    for row in rows:
        row.sort(key=lambda s: s["x0"])
    return rows


def join(a, b):
    if not a:
        return b
    if re.search(r"[A-Za-z0-9.,;:)]$", a) and re.match(r"[A-Za-z0-9(]", b):
        return a + " " + b
    return a + b


def clean(text):
    text = text.replace("", "－")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def parse_questions(pdf_path):
    doc = pymupdf.open(pdf_path)
    code = None
    tokens = []  # ("num", n) | ("label", "A") | ("text", s, newline_before)
    started = False
    for page in doc:
        for row in rows_of(page):
            text_row = "".join(s["text"] for s in row)
            m = re.search(r"代號：\s*(\d{4})", text_row)
            if m:
                code = code or m.group(1)
            if row[0]["top"] < 70 or row[0]["top"] > 815 or re.search(r"代號：|頁次：", text_row):
                continue  # page header / footer
            first = row[0]
            num_match = re.fullmatch(r"\s*(\d{1,2})\s*", first["text"])
            if num_match and first["x0"] < 58 and "Times" in first["font"]:
                started = True
                tokens.append(("num", int(num_match.group(1))))
                row = row[1:]
            if not started:
                continue
            new_row = True
            for span in row:
                parts = re.split(r"([-])", span["text"])
                for part in parts:
                    if part in LABELS:
                        tokens.append(("label", LABELS[part]))
                        new_row = False
                    elif part.strip():
                        tokens.append(("text", part, new_row))
                        new_row = False
    questions = []
    current = None
    target = None
    for token in tokens:
        if token[0] == "num":
            expected = len(questions) + 1
            if token[1] != expected:
                raise ValueError(f"{pdf_path}: expected question {expected}, got {token[1]}")
            current = {"no": token[1], "stem": "", "choices": []}
            questions.append(current)
            target = current
        elif token[0] == "label":
            choice = {"id": token[1], "text": ""}
            current["choices"].append(choice)
            target = choice
        else:
            key = "stem" if target is current else "text"
            target[key] = join(target[key], token[1])
    for question in questions:
        question["stem"] = clean(question["stem"])
        for choice in question["choices"]:
            choice["text"] = clean(choice["text"])
    return code, questions


def parse_answers(pdf_path):
    page = pymupdf.open(pdf_path)[0]
    words = page.get_text("words")
    labels = []
    for w in words:
        m = re.fullmatch(r"第(\d+)題", w[4])
        if m:
            labels.append((int(m.group(1)), w))
    answers = {}
    for no, lw in labels:
        cx = (lw[0] + lw[2]) / 2
        for w in words:
            if w[1] > lw[3] and w[1] - lw[3] < 15 and abs((w[0] + w[2]) / 2 - cx) < 12 \
                    and re.fullmatch(r"[A-E#]+", w[4]):
                answers[no] = w[4]
    text = page.get_text()
    note = ""
    m = re.search(r"備\s*註：\s*([^\n]*)", text)
    if m:
        note = m.group(1).strip()
    return answers, note


def apply_note(questions, note):
    if not note:
        return
    for sentence in re.split(r"[。；;，,]", note):
        sentence = sentence.strip()
        if not sentence:
            continue
        nos = [int(n) for n in re.findall(r"第(\d+)題", sentence)]
        if not nos:
            raise ValueError(f"unparsed note: {sentence}")
        letters = list(dict.fromkeys(re.findall(r"[A-D]", sentence.translate(FULLWIDTH).split("答", 1)[-1])))
        for no in nos:
            q = questions[no - 1]
            q["answerRevised"] = True
            if "一律給分" in sentence:
                q["acceptedAnswers"] = [c["id"] for c in q["choices"]]
                q["answer"] = q["acceptedAnswers"][0]
            elif len(letters) > 1:
                q["acceptedAnswers"] = letters
                q["answer"] = letters[0]
            elif len(letters) == 1:
                q["answer"] = letters[0]
            else:
                raise ValueError(f"unparsed note: {sentence}")


def main():
    root = Path(sys.argv[1])
    out = Path(sys.argv[2])
    for year in range(110, 116):
        folder = root / f"{year}年公務人員初等考試" / "一般行政"
        for subject, slug in SUBJECTS.items():
            qfile = folder / f"{year}_{subject}_試題.pdf"
            afile = folder / f"{year}_{subject}_更正答案.pdf"
            if not afile.exists():
                afile = folder / f"{year}_{subject}_答案.pdf"
            code, questions = parse_questions(qfile)
            answers, note = parse_answers(afile)
            problems = []
            if len(questions) != 50:
                problems.append(f"{len(questions)} questions")
            for q in questions:
                ans = answers.get(q["no"])
                if not ans:
                    problems.append(f"q{q['no']} no answer")
                q["answer"] = ans
                ids = [c["id"] for c in q["choices"]]
                if ids != ["A", "B", "C", "D"]:
                    problems.append(f"q{q['no']} choices {ids}")
                if not q["stem"] or any(not c["text"] for c in q["choices"]):
                    problems.append(f"q{q['no']} empty text")
            apply_note(questions, note)
            for q in questions:
                if q["answer"] == "#" or q["answer"] not in "ABCD":
                    problems.append(f"q{q['no']} unresolved answer {q['answer']}")
            ordered = [{k: q[k] for k in ("no", "answer", "acceptedAnswers", "answerRevised", "stem", "choices") if k in q}
                       for q in questions]
            data = {
                "id": f"{year}-elementary-general-admin-{slug}",
                "year": year,
                "exam": f"{year}年公務人員初等考試",
                "level": "初等考試",
                "category": "一般行政",
                "subject": subject,
                "subjectCode": code,
                "durationMinutes": 60,
                "questionCount": len(ordered),
                "pointsEach": 2,
                "sourceFile": qfile.name,
                "answerSourceFile": afile.name,
            }
            if note:
                data["answerNote"] = note
            data["questions"] = ordered
            target = out / str(year) / f"{subject}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(year, subject, code, len(ordered), "note:" + note if note else "", "PROBLEMS:" if problems else "ok", problems)


if __name__ == "__main__":
    main()
