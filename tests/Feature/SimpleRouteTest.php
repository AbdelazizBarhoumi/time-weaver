<?php

namespace Tests\Feature;

use Tests\TestCase;

class SimpleRouteTest extends TestCase
{
    public function test_test_route(): void
    {
        $response = $this->get('/api/test-route');
        $this->assertEquals(200, $response->status());
        $this->assertEquals('test route works', $response->getContent());
    }
}
