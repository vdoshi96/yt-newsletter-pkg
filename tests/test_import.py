def test_package_imports():
    import yt_newsletter.monitor as m

    assert hasattr(m, "main")
    assert (m.PROJECT_ROOT / "pyproject.toml").is_file()
