import argparse
import json
import os
from pathlib import Path
from typing import Any

import requests


BASE_URL = "https://api.cubemaster.net"


def parse_response(resp: requests.Response) -> Any:
	content_type = resp.headers.get("Content-Type", "")
	if "application/json" in content_type:
		return resp.json()
	return resp.text


def call_api(
	method: str,
	path: str,
	token: str,
	params: dict[str, Any] | None = None,
	payload: dict[str, Any] | None = None,
) -> tuple[int, Any]:
	url = f"{BASE_URL}{path}"
	headers = {"TokenID": token}

	resp = requests.request(
		method=method.upper(),
		url=url,
		headers=headers,
		params=params,
		json=payload,
		timeout=30,
	)
	return resp.status_code, parse_response(resp)


def print_result(status: int, body: Any) -> None:
	print(f"HTTP {status}")
	if isinstance(body, (dict, list)):
		print(json.dumps(body, ensure_ascii=False, indent=2))
	else:
		print(body)


def command_check_token(token: str) -> None:
	status, body = call_api("GET", "/Loads", token, params={"limit": 1})
	print_result(status, body)


def command_list_loads(token: str, limit: int) -> None:
	status, body = call_api("GET", "/Loads", token, params={"limit": limit})
	print_result(status, body)


def command_get_load(token: str, load_id: str) -> None:
	status, body = call_api("GET", f"/Loads/{load_id}", token)
	print_result(status, body)


def command_create_load(token: str, payload_file: str) -> None:
	payload_path = Path(payload_file)
	if not payload_path.exists():
		raise SystemExit(f"Payload file not found: {payload_file}")

	with payload_path.open("r", encoding="utf-8") as f:
		payload = json.load(f)

	status, body = call_api("POST", "/Loads", token, payload=payload)
	print_result(status, body)


def command_call_path(token: str, method: str, path: str, limit: int) -> None:
	params: dict[str, Any] | None = None
	if path == "/Loads" and method.upper() == "GET":
		params = {"limit": limit}

	status, body = call_api(method, path, token, params=params)
	print_result(status, body)


def build_parser() -> argparse.ArgumentParser:
	parser = argparse.ArgumentParser(description="CubeMaster API integration helper")
	parser.add_argument(
		"--token",
		default="",
		help="API TokenID. If omitted, reads CUBEMASTER_TOKEN.",
	)

	subparsers = parser.add_subparsers(dest="command")

	check_parser = subparsers.add_parser("check-token", help="Step 1: validate token with GET /Loads")
	check_parser.add_argument("--token", default="", help="Override token for this command")

	list_parser = subparsers.add_parser("list-loads", help="Step 2: list load results")
	list_parser.add_argument("--token", default="", help="Override token for this command")
	list_parser.add_argument("--limit", type=int, default=1, help="Number of records to fetch")

	get_parser = subparsers.add_parser("get-load", help="Step 4: query one load by id")
	get_parser.add_argument("--token", default="", help="Override token for this command")
	get_parser.add_argument("--load-id", required=True, help="Load id to query")

	create_parser = subparsers.add_parser("create-load", help="Step 3: create calculation via POST /Loads")
	create_parser.add_argument("--token", default="", help="Override token for this command")
	create_parser.add_argument("--payload-file", required=True, help="Path to JSON payload file")

	path_parser = subparsers.add_parser("call", help="Call any API path directly")
	path_parser.add_argument("--token", default="", help="Override token for this command")
	path_parser.add_argument("--method", default="GET", help="HTTP method")
	path_parser.add_argument("--path", required=True, help="API path, for example /Loads")
	path_parser.add_argument("--limit", type=int, default=1, help="limit for GET /Loads")

	return parser


def main() -> None:
	parser = build_parser()
	args = parser.parse_args()
	token = args.token or os.getenv("CUBEMASTER_TOKEN", "")

	if not token:
		raise SystemExit("Missing token: pass --token or set CUBEMASTER_TOKEN")

	if args.command in (None, "check-token"):
		command_check_token(token)
	elif args.command == "list-loads":
		command_list_loads(token, args.limit)
	elif args.command == "get-load":
		command_get_load(token, args.load_id)
	elif args.command == "create-load":
		command_create_load(token, args.payload_file)
	elif args.command == "call":
		command_call_path(token, args.method, args.path, args.limit)
	else:
		parser.print_help()


if __name__ == "__main__":
	main()
