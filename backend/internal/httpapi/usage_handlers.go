package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *API) listOwnUsageLogs(c *gin.Context) {
	limit, offset := parsePagination(c)
	result, err := a.repo.ListUsageLogs(c.Request.Context(), currentUser(c).ID, limit, offset)
	if err != nil {
		a.internalError(c, "list own usage logs", err)
		return
	}
	result.Items = jsonArray(result.Items)
	c.JSON(http.StatusOK, result)
}
