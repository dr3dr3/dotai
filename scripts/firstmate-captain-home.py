#!/usr/bin/env python3
"""Resolve the configured local captain home without creating or claiming it."""
import json
import os
from pathlib import Path
import sys

CONFIGURED = Path('/workspace/.firstmate-home')
REGISTRY = Path('/workspace/.git/roe-runtime.json')

def resolve_home(supplied, registry=REGISTRY, configured=CONFIGURED):
    expected = configured.resolve(strict=True)
    selected = Path(supplied).resolve(strict=True) if supplied else expected
    if selected != expected:
        raise ValueError('captain FM_HOME differs from the configured local stack home')
    data = json.loads(registry.read_text())
    if data.get('version') != 1 or str(expected) not in data.get('homes', []):
        raise ValueError('configured captain home is not registered for runtime coordination')
    if not all((expected / part).is_dir() for part in ('config', 'data', 'state')):
        raise ValueError('configured captain home is not initialised; refusing to create it')
    return str(expected)

if __name__ == '__main__':
    try:
        print(resolve_home(os.environ.get('FM_HOME')))
    except (OSError, ValueError, TypeError) as exc:
        sys.exit(f'firstmate-captain-home: {exc}')
