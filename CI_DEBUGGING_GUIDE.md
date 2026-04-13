# CI Debugging Guide

## Firebird Log Display on Test Failures

### Overview
When tests fail in the CI pipeline, the workflow automatically displays Firebird server logs to help with debugging. This feature was added to make it easier to diagnose connection, authentication, and other Firebird-related issues.

### What Gets Displayed

When a test fails, the following information is automatically shown:

1. **Firebird Server Log** (last 100 lines)
   - Location: `/firebird/log/firebird.log` inside the Docker container
   - Contains Firebird server events, errors, warnings, and diagnostic information
   - Useful for diagnosing authentication failures, connection issues, and SQL errors

2. **Docker Container Status**
   - Shows if the Firebird container is running, stopped, or has exited
   - Displays container ID, image, status, and ports
   - Command: `docker ps -a`

3. **Docker Container Logs** (last 50 lines)
   - Shows the stdout/stderr output from the Firebird container
   - Includes startup messages and any runtime errors
   - Command: `docker logs firebird --tail 50`

### How It Works

The workflow uses GitHub Actions' conditional execution:

```yaml
- name: Show Firebird log on failure
  if: failure()
  run: |
    # Display Firebird log
    docker exec firebird tail -n 100 /firebird/log/firebird.log || echo "Could not read firebird.log"
    # Display container status
    docker ps -a
    # Display container logs
    docker logs firebird --tail 50
```

**Key Features:**
- Only runs when previous steps fail (`if: failure()`)
- No performance impact on successful builds
- Gracefully handles missing log file with fallback message
- Works with all Firebird versions (3, 4, 5)

### Interpreting the Output

#### Common Firebird Log Patterns

**Authentication Failures:**
```
INET/inet_error: read errno = 104
login by SYSDBA failed (authentication failed)
```

**Connection Issues:**
```
INET/inet_error: connect errno = 111
connection refused
```

**Database Errors:**
```
Database: /firebird/data/test.fdb
validation error
```

#### Docker Container Status

**Running Container:**
```
CONTAINER ID   IMAGE                    STATUS
abc123...      firebirdsql/firebird:5   Up 2 minutes
```

**Stopped Container:**
```
CONTAINER ID   IMAGE                    STATUS
abc123...      firebirdsql/firebird:5   Exited (1) 2 minutes ago
```

### Testing Locally

To test the Firebird log display locally:

1. Start Firebird Docker container:
   ```bash
   docker run -d --name firebird \
     -e FIREBIRD_ROOT_PASSWORD="masterkey" \
     -p 3050:3050 \
     firebirdsql/firebird:5
   ```

2. View Firebird log:
   ```bash
   docker exec firebird tail -n 100 /firebird/log/firebird.log
   ```

3. Check container status:
   ```bash
   docker ps -a
   ```

4. View container logs:
   ```bash
   docker logs firebird --tail 50
   ```

### Troubleshooting

**"Could not read firebird.log" message:**
- The log file may not exist yet (Firebird hasn't started)
- The log path may be different (though it's standard across versions 3-5)
- Check the Docker container logs for more information

**No output shown:**
- Verify the step ran (check GitHub Actions logs)
- Ensure the `if: failure()` condition was triggered
- Check that the Firebird container is running

**Container not found:**
- The container may have been removed before this step ran
- Check earlier steps in the workflow for container lifecycle issues

### Related Documentation

- [Firebird Documentation](https://firebirdsql.org/en/documentation/)
- [GitHub Actions Conditional Execution](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idif)
- [Docker Logging](https://docs.docker.com/config/containers/logging/)

### Contributing

If you encounter issues with the log display or have suggestions for improvement:

1. Check if the Firebird log path has changed in newer versions
2. Verify the Docker container name matches (`firebird`)
3. Test with different Firebird versions (3, 4, 5)
4. Submit an issue or pull request with your findings

### Version History

- **2026-03-23**: Initial implementation
  - Added automatic Firebird log display on test failure
  - Includes Docker container status and logs
  - Works with Firebird 3, 4, and 5
