# Firebird Log Display Feature

## Quick Reference

### What Was Added
Automatic display of Firebird server logs when CI tests fail.

### Where
- **Implementation**: `.github/workflows/node.js.yml` (lines 77-93)
- **Documentation**: `CI_DEBUGGING_GUIDE.md`

### When It Runs
Only when tests fail in CI (uses `if: failure()` condition)

### What It Shows
1. Last 100 lines of Firebird server log
2. Docker container status
3. Last 50 lines of Docker container logs

## Quick Commands

### View logs locally:
```bash
# Start Firebird container
docker run -d --name firebird \
  -e FIREBIRD_ROOT_PASSWORD="masterkey" \
  -p 3050:3050 \
  firebirdsql/firebird:5

# View Firebird log
docker exec firebird tail -n 100 /firebird/log/firebird.log

# Check container status
docker ps -a

# View container logs
docker logs firebird --tail 50
```

### Test the workflow locally:
```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/node.js.yml'))"
```

## Implementation Details

### GitHub Actions Step
```yaml
- name: Show Firebird log on failure
  if: failure()
  run: |
    echo "=========================================="
    echo "Firebird Server Log (last 100 lines):"
    echo "=========================================="
    docker exec firebird tail -n 100 /firebird/log/firebird.log || echo "Could not read firebird.log"
    echo ""
    echo "=========================================="
    echo "Docker container status:"
    echo "=========================================="
    docker ps -a
    echo ""
    echo "=========================================="
    echo "Docker container logs:"
    echo "=========================================="
    docker logs firebird --tail 50
```

### Key Features
- ✅ Conditional execution (only on failure)
- ✅ Graceful error handling
- ✅ Formatted output with clear sections
- ✅ Works with Firebird 3, 4, and 5
- ✅ Zero performance impact on successful builds

## Common Issues & Solutions

### Issue: "Could not read firebird.log"
**Solution**: Check Docker container logs, the file might not exist yet

### Issue: Container not found
**Solution**: Verify container name is "firebird" and it's still running

### Issue: Empty log output
**Solution**: Firebird might not have written logs yet, check startup time

## Firebird Log Locations

### In Docker Container
- **Log file**: `/firebird/log/firebird.log`
- **Config**: `/firebird/etc/firebird.conf`
- **Install**: `/opt/firebird`

### Consistent Across Versions
The log path is the same for:
- Firebird 3.x
- Firebird 4.x
- Firebird 5.x

## Maintenance

### If log path changes:
1. Update `.github/workflows/node.js.yml`
2. Update `CI_DEBUGGING_GUIDE.md`
3. Test with all Firebird versions

### If more lines needed:
- Change `tail -n 100` to desired number
- Change `--tail 50` for Docker logs

### If additional diagnostics needed:
Add new echo sections in the workflow step

## Related Files

- `.github/workflows/node.js.yml` - CI workflow with log display
- `CI_DEBUGGING_GUIDE.md` - Comprehensive debugging guide
- `README.md` - Main project documentation

## Version History

- **2026-03-23**: Initial implementation
  - Added conditional log display on test failure
  - Created comprehensive documentation
  - Tested with Firebird 3, 4, 5

## Contributing

To improve this feature:
1. Test with different Firebird versions
2. Verify log paths remain consistent
3. Submit issues or PRs with enhancements
4. Update documentation as needed

## Support

For questions or issues:
1. Check `CI_DEBUGGING_GUIDE.md` for troubleshooting
2. Review GitHub Actions logs for the step execution
3. Test locally using provided commands
4. Submit an issue if problems persist

---

**Note**: This feature is designed for CI environments. For local development, use the Docker commands directly.
