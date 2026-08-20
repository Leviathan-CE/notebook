import ast
import base64
import contextlib
import io
import json
import sys
import traceback

NS = {"__name__": "__main__"}


def _capture_plots():
    images = []
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return images
    for number in list(plt.get_fignums()):
        figure = plt.figure(number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight")
        images.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
    plt.close("all")
    return images


def run(code: str):
    stdout = io.StringIO()
    stderr = io.StringIO()
    result = None
    error = None
    ok = True
    try:
        tree = ast.parse(code, filename="<nmd>")
        body = tree.body
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            if body and isinstance(body[-1], ast.Expr):
                preamble = ast.Module(body=body[:-1], type_ignores=[])
                last = ast.Expression(body[-1].value)
                ast.fix_missing_locations(preamble)
                ast.fix_missing_locations(last)
                if preamble.body:
                    exec(compile(preamble, "<nmd>", "exec"), NS)
                value = eval(compile(last, "<nmd>", "eval"), NS)
                if value is not None:
                    result = repr(value)
                    NS["_"] = value
            else:
                exec(compile(tree, "<nmd>", "exec"), NS)
    except Exception:
        ok = False
        error = traceback.format_exc()
    return {
        "ok": ok,
        "stdout": stdout.getvalue(),
        "stderr": stderr.getvalue(),
        "result": result,
        "error": error,
        "images": _capture_plots(),
    }


def _line_prefix(code: str, line: int, column: int) -> str:
    lines = code.split("\n")
    if not lines:
        return ""
    idx = min(max(line - 1, 0), len(lines) - 1)
    text = lines[idx]
    col = min(max(column, 0), len(text))
    text = text[:col]
    start = len(text)
    while start > 0 and (text[start - 1].isalnum() or text[start - 1] in "_."):
        start -= 1
    return text[start:]


def _rlcomplete(code: str, line: int, column: int):
    import rlcompleter

    prefix = _line_prefix(code, line, column)
    completer = rlcompleter.Completer(NS)
    items = []
    seen = set()
    index = 0
    while True:
        match = completer.complete(prefix, index)
        if match is None:
            break
        index += 1
        label = match.rsplit(".", 1)[-1] if "." in prefix else match
        if not label or label in seen:
            continue
        seen.add(label)
        items.append({"label": label, "kind": "instance", "detail": match})
        if len(items) >= 200:
            break
    return items


def complete(code: str, line: int, column: int):
    try:
        import jedi

        script = jedi.Interpreter(code, namespaces=[NS])
        items = []
        seen = set()
        for candidate in script.complete(line, column):
            label = candidate.name
            if not label or label in seen:
                continue
            seen.add(label)
            items.append(
                {
                    "label": label,
                    "kind": candidate.type,
                    "detail": candidate.description,
                }
            )
            if len(items) >= 200:
                break
        return {"ok": True, "completions": items}
    except Exception:
        return {"ok": True, "completions": _rlcomplete(code, line, column)}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        message = json.loads(line)
        msg_type = message.get("type") or "run"
        if msg_type == "shutdown":
            break
        if msg_type == "complete":
            payload = complete(
                message.get("code", ""),
                int(message.get("line") or 1),
                int(message.get("column") or 0),
            )
        else:
            payload = run(message.get("code", ""))
        payload["id"] = message.get("id")
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
