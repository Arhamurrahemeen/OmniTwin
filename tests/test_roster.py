import pytest
from routers.roster import is_over_limit, make_project_id, parse_roster_csv

def test_parse_roster_csv_skips_header_and_junk():
    text = "name,email\nAli Khan,ali@duet.edu.pk\n,broken@\nNoatSign.co\nSara, sara@duet.edu.pk\n"
    rows = parse_roster_csv(text)
    assert len(rows) == 2
    assert {"name": "Ali Khan", "email": "ali@duet.edu.pk"} in rows
    assert {"name": "Sara", "email": "sara@duet.edu.pk"} in rows

def test_parse_roster_csv_empty():
    assert parse_roster_csv("") == []
    assert parse_roster_csv("name,email\n") == []

def test_quota_boundary():
    assert not is_over_limit(0, 1)
    assert is_over_limit(1, 1)      # exactly at limit → denied
    assert not is_over_limit(1, 2)
    assert is_over_limit(2, 2)

def test_make_project_id_safe():
    pid = make_project_id("Boiler Twin 2", "ali@duet.edu.pk")
    import re
    assert re.fullmatch(r"[\w\-]+", pid)