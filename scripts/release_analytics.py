#!/usr/bin/env python3
"""Release analytics for Ptolemy.

CLI tool called during the release pipeline to track build and release lifecycle
events in PostHog. Pairs with scripts/sync-versions.ts in the release workflow.

Usage:
    python scripts/release_analytics.py release_published --version 1.2.3 --channel stable
    python scripts/release_analytics.py canary_release_started --version 1.3.0-canary.1
    python scripts/release_analytics.py build_completed --version 1.2.3 --channel stable --duration 45
    python scripts/release_analytics.py build_failed --version 1.2.3 --channel stable --error "compile_error"
"""

import argparse
import atexit
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
from posthog import Posthog

load_dotenv()

INSTALL_ID_FILE = Path.home() / ".ptolomeu_install_id"


def get_install_id() -> str:
    """Return a stable anonymous identifier for this developer installation."""
    if INSTALL_ID_FILE.exists():
        stored = INSTALL_ID_FILE.read_text().strip()
        if stored:
            return stored
    new_id = f"dev_{uuid.uuid4().hex[:12]}"
    INSTALL_ID_FILE.write_text(new_id)
    return new_id


def initialize_posthog() -> Posthog | None:
    """Initialize the PostHog client from environment variables."""
    project_token = os.getenv("POSTHOG_PROJECT_TOKEN")
    if not project_token:
        print("WARNING: POSTHOG_PROJECT_TOKEN not set — analytics will not be sent.")
        return None

    host = os.getenv("POSTHOG_HOST")
    if not host:
        print("WARNING: POSTHOG_HOST not set — analytics will not be sent.")
        return None

    client = Posthog(
        project_token,
        host=host,
        enable_exception_autocapture=True,
    )
    atexit.register(client.shutdown)
    return client


def cmd_release_published(args: argparse.Namespace, client: Posthog | None) -> None:
    """Track a published release (stable or canary)."""
    if not client:
        return
    client.capture(
        distinct_id=get_install_id(),
        event="release_published",
        properties={
            "version": args.version,
            "channel": args.channel,
            "platform": "macos",
        },
    )
    print(f"Tracked release_published: {args.version} ({args.channel})")


def cmd_canary_release_started(args: argparse.Namespace, client: Posthog | None) -> None:
    """Track the start of a canary build pipeline."""
    if not client:
        return
    client.capture(
        distinct_id=get_install_id(),
        event="canary_release_started",
        properties={
            "version": args.version,
            "platform": "macos",
        },
    )
    print(f"Tracked canary_release_started: {args.version}")


def cmd_build_completed(args: argparse.Namespace, client: Posthog | None) -> None:
    """Track a successful build."""
    if not client:
        return
    properties: dict = {
        "version": args.version,
        "channel": args.channel,
        "platform": "macos",
    }
    if args.duration is not None:
        properties["duration_seconds"] = args.duration
    client.capture(
        distinct_id=get_install_id(),
        event="build_completed",
        properties=properties,
    )
    print(f"Tracked build_completed: {args.version} ({args.channel})")


def cmd_build_failed(args: argparse.Namespace, client: Posthog | None) -> None:
    """Track a failed build."""
    if not client:
        return
    properties: dict = {
        "version": args.version,
        "channel": args.channel,
        "platform": "macos",
    }
    if args.error:
        properties["error_type"] = args.error
    client.capture(
        distinct_id=get_install_id(),
        event="build_failed",
        properties=properties,
    )
    print(f"Tracked build_failed: {args.version} ({args.channel})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ptolemy release analytics")
    subparsers = parser.add_subparsers(dest="command", help="Event to track")

    # release_published
    pub = subparsers.add_parser("release_published", help="Track a published release")
    pub.add_argument("--version", required=True, help="Release version (e.g. 1.2.3)")
    pub.add_argument("--channel", default="stable", help="Release channel (stable|canary)")

    # canary_release_started
    canary = subparsers.add_parser("canary_release_started", help="Track canary build start")
    canary.add_argument("--version", required=True, help="Canary version (e.g. 1.3.0-canary.1)")

    # build_completed
    completed = subparsers.add_parser("build_completed", help="Track a successful build")
    completed.add_argument("--version", required=True, help="Version that was built")
    completed.add_argument("--channel", default="stable", help="Build channel")
    completed.add_argument("--duration", type=int, default=None, help="Build duration in seconds")

    # build_failed
    failed = subparsers.add_parser("build_failed", help="Track a failed build")
    failed.add_argument("--version", required=True, help="Version that failed")
    failed.add_argument("--channel", default="stable", help="Build channel")
    failed.add_argument("--error", default=None, help="Error type identifier")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return

    client = initialize_posthog()

    try:
        if args.command == "release_published":
            cmd_release_published(args, client)
        elif args.command == "canary_release_started":
            cmd_canary_release_started(args, client)
        elif args.command == "build_completed":
            cmd_build_completed(args, client)
        elif args.command == "build_failed":
            cmd_build_failed(args, client)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        if client:
            client.capture_exception(e, get_install_id())
        sys.exit(1)
    finally:
        if client:
            client.shutdown()


if __name__ == "__main__":
    main()
