"""Live Director planning accepted zero and negative inference steps as valid.

The same unchecked fields reached render requests. Reject invalid work before
estimating it or scheduling GPU generation; no GPU is needed to check inputs.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.director.routes import router


@pytest.mark.parametrize('endpoint', ['plan', 'render'])
@pytest.mark.parametrize('steps', [0, -4])
def test_director_refuses_nonpositive_steps(endpoint, steps):
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post('/api/director/' + endpoint,
        json={'script': 'A quiet lake', 'steps': steps})
    assert response.status_code == 422
    assert any(error['loc'] == ['body', 'steps'] for error in response.json()['detail'])


@pytest.mark.parametrize('dimension', ['width', 'height'])
@pytest.mark.parametrize('value', [0, -8])
def test_director_refuses_nonpositive_dimensions(dimension, value):
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post('/api/director/render',
        json={'script': 'A quiet lake', dimension: value})
    assert response.status_code == 422
    assert any(error['loc'] == ['body', dimension] for error in response.json()['detail'])
